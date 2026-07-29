/**
 * CONFIGURACIÓN EDITABLE
 *
 * Cambiá estos valores antes de instalar el sistema en otra cuenta.
 */
const CONFIG = Object.freeze({
  // Recibe las solicitudes con los botones Aceptar y Rechazar.
  ADMIN_EMAIL: 'administracion@ejemplo.com',

  // Cuenta que instala el script, o un alias verificado de esa cuenta.
  SENDER_EMAIL: 'administracion@ejemplo.com',
  SENDER_NAME: 'Bienestar Universitario - UNPA UARG',

  // URL /exec de la implementación como aplicación web.
  WEB_APP_URL: 'PEGAR_AQUI_LA_URL_TERMINADA_EN_EXEC',

  // ID de credencial-base.png después de subirla a Google Drive.
  TEMPLATE_IMAGE_FILE_ID: 'PEGAR_AQUI_EL_ID_DE_LA_IMAGEN',

  // Puede quedar vacío: el sistema crea esta carpeta en Mi unidad.
  OUTPUT_FOLDER_ID: '',
  OUTPUT_FOLDER_NAME: 'Credenciales digitales generadas',

  TIMEZONE: 'America/Argentina/Buenos_Aires',
  APPROVAL_SUBJECT: 'Nueva solicitud de credencial digital',
  CREDENTIAL_SUBJECT: 'Credencial digital',
  REJECTION_SUBJECT: 'Solicitud de credencial digital',

  // Textos que recibe la persona al aceptar o rechazar.
  CREDENTIAL_MESSAGE:
    'Adjuntamos su credencial digital. La credencial sólo tiene validez presentando el DNI.',
  REJECTION_MESSAGE:
    'Usted no figura como alumno/a regular. Por cualquier consulta, acérquese a las oficinas de Bienestar Universitario.',

  SYSTEM_HEADERS: Object.freeze({
    STATUS: 'Estado credencial',
    TOKEN: 'Token de decisión',
    DECIDED_AT: 'Fecha de decisión',
    CREDENTIAL_FILE_ID: 'ID archivo credencial',
    OBSERVATION: 'Observación del sistema',
  }),
});

/**
 * Sistema automático de credenciales digitales.
 *
 * Se instala como script vinculado a la hoja de respuestas de Google Forms.
 * El flujo es:
 * 1) alEnviarFormulario -> correo al administrador;
 * 2) doGet -> procesa Aceptar/Rechazar desde el botón del correo;
 * 3) al aceptar -> genera PNG, lo archiva en Drive y lo envía;
 * 4) al rechazar -> envía el mensaje de rechazo sin generar imagen.
 */

function instalarSistema() {
  validarConfiguracion_();

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = obtenerHojaDeRespuestas_(spreadsheet);
  asegurarColumnasSistema_(sheet);

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'alEnviarFormulario')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('alEnviarFormulario')
    .forSpreadsheet(spreadsheet)
    .onFormSubmit()
    .create();

  console.log(
    'Sistema instalado. Las nuevas respuestas enviarán una solicitud a ' +
      CONFIG.ADMIN_EMAIL +
      '.',
  );
}

/**
 * Ejecutar una vez en cada cuenta para abrir la pantalla de autorización y
 * comprobar que la imagen base puede leerse desde Google Drive.
 */
function autorizarPermisos() {
  const archivo = DriveApp.getFileById(CONFIG.TEMPLATE_IMAGE_FILE_ID);
  console.log(
    'Permisos autorizados. Imagen base: ' + archivo.getName(),
  );
}

function alEnviarFormulario(event) {
  if (!event || !event.range) {
    throw new Error(
      'Esta función se ejecuta automáticamente. Para probar, usa notificarUltimaRespuesta().',
    );
  }

  const sheet = event.range.getSheet();
  const row = event.range.getRow();
  prepararYNotificarSolicitud_(sheet, row, false);
}

function notificarUltimaRespuesta() {
  validarConfiguracion_();
  const sheet = obtenerHojaDeRespuestas_(
    SpreadsheetApp.getActiveSpreadsheet(),
  );
  asegurarColumnasSistema_(sheet);

  if (sheet.getLastRow() < 2) {
    throw new Error('La hoja todavía no contiene respuestas.');
  }

  prepararYNotificarSolicitud_(sheet, sheet.getLastRow(), true);
}

function doGet(event) {
  try {
    validarConfiguracion_();
    const action = String(event?.parameter?.action || '').toLowerCase();
    const token = String(event?.parameter?.token || '').trim();
    const confirmed = String(event?.parameter?.confirm || '') === '1';

    if (!['aceptar', 'rechazar'].includes(action) || !token) {
      return paginaResultado_(
        'Enlace inválido',
        'El enlace no contiene una decisión válida.',
        false,
      );
    }

    const request = buscarSolicitudPorToken_(token);
    const currentStatus = String(
      request.sheet
        .getRange(request.row, request.columns.status)
        .getDisplayValue(),
    ).trim();

    if (currentStatus === 'ACEPTADA' || currentStatus === 'RECHAZADA') {
      return paginaResultado_(
        'Solicitud ya procesada',
        'Esta solicitud ya había sido ' +
          currentStatus.toLowerCase() +
          '. No se realizará ninguna acción adicional.',
        true,
      );
    }

    if (confirmed) {
      const result = procesarDecision_(action, token);
      return paginaResultado_(result.title, result.message, result.ok);
    }

    return paginaConfirmacion_(action, token);
  } catch (error) {
    console.error(error);
    return paginaResultado_(
      'No se pudo procesar la solicitud',
      error.message || String(error),
      false,
    );
  }
}

function doPost(event) {
  try {
    validarConfiguracion_();
    const action = String(event?.parameter?.action || '').toLowerCase();
    const token = String(event?.parameter?.token || '').trim();

    if (!['aceptar', 'rechazar'].includes(action) || !token) {
      return paginaResultado_(
        'Solicitud inválida',
        'No se recibió una decisión válida.',
        false,
      );
    }

    const result = procesarDecision_(action, token);
    return paginaResultado_(result.title, result.message, result.ok);
  } catch (error) {
    console.error(error);
    return paginaResultado_(
      'No se pudo procesar la solicitud',
      error.message || String(error),
      false,
    );
  }
}

function prepararYNotificarSolicitud_(sheet, row, forceResend) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    asegurarColumnasSistema_(sheet);
    const headers = obtenerEncabezados_(sheet);
    const statusColumn = buscarColumna_(headers, [
      CONFIG.SYSTEM_HEADERS.STATUS,
    ]);
    const tokenColumn = buscarColumna_(headers, [
      CONFIG.SYSTEM_HEADERS.TOKEN,
    ]);
    const observationColumn = buscarColumna_(headers, [
      CONFIG.SYSTEM_HEADERS.OBSERVATION,
    ]);

    const currentStatus = String(
      sheet.getRange(row, statusColumn).getDisplayValue() || '',
    ).trim();
    if (
      !forceResend &&
      currentStatus &&
      currentStatus !== 'PENDIENTE'
    ) {
      return;
    }

    let token = String(
      sheet.getRange(row, tokenColumn).getDisplayValue() || '',
    ).trim();
    if (!token) {
      token =
        Utilities.getUuid().replace(/-/g, '') +
        Utilities.getUuid().replace(/-/g, '');
    }

    sheet.getRange(row, statusColumn).setValue('PENDIENTE');
    sheet.getRange(row, tokenColumn).setValue(token);
    sheet.getRange(row, observationColumn).clearContent();
    SpreadsheetApp.flush();

    const response = leerFila_(sheet, row);
    enviarCorreoAprobacion_(response, token);
  } finally {
    lock.releaseLock();
  }
}

function procesarDecision_(action, token) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  let createdFile = null;
  let sheet = null;
  let row = null;
  let columns = null;

  try {
    const request = buscarSolicitudPorToken_(token);
    sheet = request.sheet;
    row = request.row;
    columns = request.columns;

    const statusCell = sheet.getRange(row, columns.status);
    const currentStatus = String(statusCell.getDisplayValue()).trim();

    if (currentStatus === 'ACEPTADA' || currentStatus === 'RECHAZADA') {
      return {
        ok: true,
        title: 'Solicitud ya procesada',
        message:
          'Esta solicitud ya había sido ' +
          currentStatus.toLowerCase() +
          '. No se realizó ninguna acción adicional.',
      };
    }

    if (currentStatus !== 'PENDIENTE') {
      throw new Error(
        'La solicitud no está pendiente. Estado actual: ' +
          (currentStatus || 'sin estado') +
          '.',
      );
    }

    statusCell.setValue('PROCESANDO');
    sheet
      .getRange(row, columns.observation)
      .setValue('Procesando decisión…');
    SpreadsheetApp.flush();

    const response = leerFila_(sheet, row);
    const recipient = obtenerCampoRequerido_(response, [
      'Correo electrónico',
      'Correo electronico',
      'Email',
      'E-mail',
    ]);
    const firstName = obtenerCampoRequerido_(response, [
      'Nombre/s',
      'Nombre',
      'Nombres',
    ]);
    const lastName = obtenerCampoRequerido_(response, [
      'Apellido/s',
      'Apellido',
      'Apellidos',
    ]);
    const dni = obtenerCampoRequerido_(response, ['DNI', 'Documento']);

    if (action === 'rechazar') {
      enviarCorreoRechazo_(recipient, firstName);
      registrarResultado_(
        sheet,
        row,
        columns,
        'RECHAZADA',
        '',
        'Solicitud rechazada y correo enviado.',
      );
      return {
        ok: true,
        title: 'Solicitud rechazada',
        message:
          'Se envió el correo de rechazo a ' + String(recipient) + '.',
      };
    }

    const claustro = normalizarClaustro_(
      obtenerCampo_(response, ['Claustro', 'Tipo de claustro']) ||
        'Estudiante',
    );
    const fullName = normalizarEspacios_(
      String(firstName) + ' ' + String(lastName),
    );
    const decisionDate = new Date();
    const expirationDate = calcularVencimiento_(decisionDate);
    const credentialBlob = generarCredencialPng_({
      fullName,
      dni: formatearDni_(dni),
      claustro,
      expiration: Utilities.formatDate(
        expirationDate,
        CONFIG.TIMEZONE,
        'dd / MM / yyyy',
      ),
    });

    createdFile = guardarCredencial_(
      credentialBlob,
      fullName,
      dni,
      expirationDate,
    );
    enviarCorreoCredencial_(
      recipient,
      firstName,
      credentialBlob,
      expirationDate,
    );

    registrarResultado_(
      sheet,
      row,
      columns,
      'ACEPTADA',
      createdFile.getId(),
      'Credencial generada y enviada.',
    );

    return {
      ok: true,
      title: 'Solicitud aceptada',
      message:
        'La credencial fue generada y enviada a ' +
        String(recipient) +
        '. Vence el ' +
        Utilities.formatDate(expirationDate, CONFIG.TIMEZONE, 'dd/MM/yyyy') +
        '.',
    };
  } catch (error) {
    if (createdFile) {
      try {
        createdFile.setTrashed(true);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }

    if (sheet && row && columns) {
      sheet.getRange(row, columns.status).setValue('PENDIENTE');
      sheet
        .getRange(row, columns.observation)
        .setValue('ERROR: ' + truncar_(error.message || String(error), 450));
      SpreadsheetApp.flush();
    }

    throw error;
  } finally {
    lock.releaseLock();
  }
}

function enviarCorreoAprobacion_(response, token) {
  const acceptUrl =
    CONFIG.WEB_APP_URL +
    '?action=aceptar&token=' +
    encodeURIComponent(token);
  const rejectUrl =
    CONFIG.WEB_APP_URL +
    '?action=rechazar&token=' +
    encodeURIComponent(token);

  const rows = Object.keys(response)
    .filter((header) => !esColumnaSistema_(header))
    .map(
      (header) =>
        '<tr>' +
        '<th style="text-align:left;padding:8px 12px;border-bottom:1px solid #d9e2e8;color:#164b67">' +
        escaparHtml_(header) +
        '</th>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #d9e2e8">' +
        escaparHtml_(formatearValorCorreo_(response[header])) +
        '</td>' +
        '</tr>',
    )
    .join('');

  const html =
    '<div style="font-family:Arial,sans-serif;color:#173042;max-width:680px">' +
    '<h2 style="color:#0b4c6b">Nueva solicitud de credencial digital</h2>' +
    '<table style="border-collapse:collapse;width:100%;margin:18px 0">' +
    rows +
    '</table>' +
    '<div style="margin:26px 0">' +
    botonHtml_('Aceptar', acceptUrl, '#137333') +
    botonHtml_('Rechazar', rejectUrl, '#b3261e') +
    '</div>' +
    '<p style="font-size:12px;color:#5f6368">Cada solicitud puede procesarse una sola vez.</p>' +
    '</div>';

  enviarEmail_(
    CONFIG.ADMIN_EMAIL,
    CONFIG.APPROVAL_SUBJECT,
    construirTextoPlano_(response, acceptUrl, rejectUrl),
    { htmlBody: html },
  );
}

function enviarCorreoCredencial_(
  recipient,
  firstName,
  credentialBlob,
  expirationDate,
) {
  const expiration = Utilities.formatDate(
    expirationDate,
    CONFIG.TIMEZONE,
    'dd/MM/yyyy',
  );
  const plainBody =
    'Hola ' +
    String(firstName) +
    ':\n\n' +
    CONFIG.CREDENTIAL_MESSAGE +
    '\n\nFecha de vencimiento: ' +
    expiration +
    '.';
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;color:#173042">' +
    '<p>Hola ' +
    escaparHtml_(firstName) +
    ':</p>' +
    '<p>' +
    escaparHtml_(CONFIG.CREDENTIAL_MESSAGE) +
    '</p>' +
    '<p><strong>Fecha de vencimiento:</strong> ' +
    expiration +
    '</p>' +
    '</div>';

  enviarEmail_(recipient, CONFIG.CREDENTIAL_SUBJECT, plainBody, {
    htmlBody,
    attachments: [credentialBlob],
  });
}

function enviarCorreoRechazo_(recipient, firstName) {
  const plainBody =
    'Hola ' +
    String(firstName) +
    ':\n\n' +
    CONFIG.REJECTION_MESSAGE;
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;color:#173042">' +
    '<p>Hola ' +
    escaparHtml_(firstName) +
    ':</p>' +
    '<p>' +
    escaparHtml_(CONFIG.REJECTION_MESSAGE) +
    '</p>' +
    '</div>';

  enviarEmail_(recipient, CONFIG.REJECTION_SUBJECT, plainBody, {
    htmlBody,
  });
}

function enviarEmail_(recipient, subject, body, extraOptions) {
  const options = Object.assign(
    {
      name: CONFIG.SENDER_NAME,
    },
    extraOptions || {},
  );

  const effectiveEmail = String(
    Session.getEffectiveUser().getEmail() || '',
  ).toLowerCase();
  const requestedSender = String(CONFIG.SENDER_EMAIL || '').toLowerCase();

  if (
    requestedSender &&
    effectiveEmail &&
    requestedSender !== effectiveEmail
  ) {
    const aliases = GmailApp.getAliases();
    const matchingAlias = aliases.find(
      (alias) => String(alias).toLowerCase() === requestedSender,
    );
    if (!matchingAlias) {
      throw new Error(
        'SENDER_EMAIL no coincide con la cuenta que ejecuta el sistema ni es un alias verificado.',
      );
    }
    options.from = matchingAlias;
  }

  GmailApp.sendEmail(String(recipient), String(subject), String(body), options);
}

function generarCredencialPng_(data) {
  const templateBlob = DriveApp.getFileById(
    CONFIG.TEMPLATE_IMAGE_FILE_ID,
  ).getBlob();
  const presentation = SlidesApp.create(
    'Credencial temporal - ' + data.fullName,
  );
  const presentationId = presentation.getId();

  try {
    const slide = presentation.getSlides()[0];
    slide.getPageElements().forEach((element) => element.remove());

    const pageWidth = presentation.getPageWidth();
    const pageHeight = presentation.getPageHeight();
    slide.insertImage(templateBlob, 0, 0, pageWidth, pageHeight);

    // Las máscaras limpian los datos de ejemplo y las líneas punteadas para
    // presentar los datos dinámicos con una composición más legible.
    agregarMascara_(slide, pageWidth, pageHeight, 0.027, 0.055, 0.285, 0.13);
    agregarMascara_(slide, pageWidth, pageHeight, 0.282, 0.305, 0.396, 0.075);
    agregarMascara_(slide, pageWidth, pageHeight, 0.035, 0.455, 0.645, 0.065);
    agregarMascara_(slide, pageWidth, pageHeight, 0.095, 0.53, 0.583, 0.09);
    agregarMascara_(slide, pageWidth, pageHeight, 0.275, 0.805, 0.165, 0.06);

    agregarTexto_(
      slide,
      data.claustro,
      pageWidth,
      pageHeight,
      0.035,
      0.06,
      0.275,
      0.12,
      tamanoClaustro_(data.claustro),
      SlidesApp.ParagraphAlignment.START,
    );
    agregarTexto_(
      slide,
      data.fullName,
      pageWidth,
      pageHeight,
      0.30,
      0.295,
      0.33,
      0.075,
      tamanoNombre_(data.fullName),
      SlidesApp.ParagraphAlignment.CENTER,
    );
    agregarTexto_(
      slide,
      data.dni,
      pageWidth,
      pageHeight,
      0.27,
      0.525,
      0.24,
      0.08,
      20,
      SlidesApp.ParagraphAlignment.CENTER,
    );
    agregarTexto_(
      slide,
      data.expiration,
      pageWidth,
      pageHeight,
      0.278,
      0.795,
      0.165,
      0.08,
      16,
      SlidesApp.ParagraphAlignment.CENTER,
    );

    const slideId = slide.getObjectId();
    presentation.saveAndClose();

    const thumbnailBlob = descargarMiniaturaSlide_(
      presentationId,
      slideId,
    );
    return thumbnailBlob
      .setContentType('image/png')
      .setName('credencial-' + nombreArchivoSeguro_(data.fullName) + '.png');
  } finally {
    try {
      DriveApp.getFileById(presentationId).setTrashed(true);
    } catch (cleanupError) {
      console.error(cleanupError);
    }
  }
}

function descargarMiniaturaSlide_(presentationId, slideId) {
  const endpoint =
    'https://docs.google.com/presentation/d/' +
    encodeURIComponent(presentationId) +
    '/export/png?pageid=' +
    encodeURIComponent(slideId);
  let lastError = '';

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      Utilities.sleep(500 * Math.pow(2, attempt));
    }

    const response = UrlFetchApp.fetch(endpoint, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      },
      followRedirects: true,
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      return response.getBlob().setContentType('image/png');
    }

    lastError =
      'HTTP ' +
      response.getResponseCode() +
      ': ' +
      truncar_(response.getContentText(), 500);
  }

  throw new Error(
    'No se pudo descargar la credencial como PNG. ' + lastError,
  );
}

function agregarMascara_(
  slide,
  pageWidth,
  pageHeight,
  x,
  y,
  width,
  height,
) {
  const shape = slide.insertShape(
    SlidesApp.ShapeType.RECTANGLE,
    pageWidth * x,
    pageHeight * y,
    pageWidth * width,
    pageHeight * height,
  );
  shape.getFill().setSolidFill('#FFFFFF');
  shape.getBorder().setTransparent();
}

function agregarTexto_(
  slide,
  text,
  pageWidth,
  pageHeight,
  x,
  y,
  width,
  height,
  fontSize,
  alignment,
) {
  const box = slide.insertTextBox(
    String(text),
    pageWidth * x,
    pageHeight * y,
    pageWidth * width,
    pageHeight * height,
  );
  box.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  box.getFill().setTransparent();
  box.getBorder().setTransparent();

  const textRange = box.getText();
  textRange
    .getTextStyle()
    .setFontFamily('Arial')
    .setFontSize(fontSize)
    .setBold(true)
    .setForegroundColor('#000000');
  textRange
    .getParagraphStyle()
    .setParagraphAlignment(alignment)
    .setSpaceAbove(0)
    .setSpaceBelow(0);
}

function guardarCredencial_(blob, fullName, dni, expirationDate) {
  const folder = obtenerCarpetaSalida_();
  const fileName =
    'Credencial - ' +
    nombreArchivoSeguro_(fullName) +
    ' - DNI ' +
    soloDigitos_(dni) +
    ' - vence ' +
    Utilities.formatDate(expirationDate, CONFIG.TIMEZONE, 'yyyy-MM-dd') +
    '.png';
  return folder.createFile(blob.copyBlob().setName(fileName));
}

function obtenerCarpetaSalida_() {
  if (CONFIG.OUTPUT_FOLDER_ID) {
    return DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID);
  }

  const properties = PropertiesService.getScriptProperties();
  const storedId = properties.getProperty('OUTPUT_FOLDER_ID');
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (error) {
      console.warn(error);
    }
  }

  const folder = DriveApp.createFolder(CONFIG.OUTPUT_FOLDER_NAME);
  properties.setProperty('OUTPUT_FOLDER_ID', folder.getId());
  return folder;
}

function calcularVencimiento_(decisionDate) {
  const localYear = Number(
    Utilities.formatDate(decisionDate, CONFIG.TIMEZONE, 'yyyy'),
  );
  const localMonthDay = Utilities.formatDate(
    decisionDate,
    CONFIG.TIMEZONE,
    'MMdd',
  );
  const expirationYear = localMonthDay >= '0331' ? localYear + 1 : localYear;
  return new Date(expirationYear, 2, 31, 12, 0, 0);
}

function asegurarColumnasSistema_(sheet) {
  let headers = obtenerEncabezados_(sheet);
  Object.values(CONFIG.SYSTEM_HEADERS).forEach((header) => {
    if (!headers.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      headers = obtenerEncabezados_(sheet);
    }
  });

  sheet.setFrozenRows(1);
}

function obtenerHojaDeRespuestas_(spreadsheet) {
  const sheets = spreadsheet.getSheets();
  const required = ['Correo electrónico', 'Apellido/s', 'Nombre/s', 'DNI'];

  const match = sheets.find((sheet) => {
    if (sheet.getLastColumn() === 0) return false;
    const normalizedHeaders = obtenerEncabezados_(sheet).map(normalizarClave_);
    return required.every((header) =>
      normalizedHeaders.includes(normalizarClave_(header)),
    );
  });

  if (!match) {
    throw new Error(
      'No se encontró una hoja con las columnas Correo electrónico, Apellido/s, Nombre/s y DNI.',
    );
  }
  return match;
}

function buscarSolicitudPorToken_(token) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = obtenerHojaDeRespuestas_(spreadsheet);
  asegurarColumnasSistema_(sheet);
  const headers = obtenerEncabezados_(sheet);
  const tokenColumn = buscarColumna_(headers, [CONFIG.SYSTEM_HEADERS.TOKEN]);
  const match = sheet
    .getRange(2, tokenColumn, Math.max(sheet.getLastRow() - 1, 1), 1)
    .createTextFinder(token)
    .matchEntireCell(true)
    .findNext();

  if (!match) {
    throw new Error('No se encontró la solicitud o el enlace ya no es válido.');
  }

  return {
    sheet,
    row: match.getRow(),
    columns: {
      status: buscarColumna_(headers, [CONFIG.SYSTEM_HEADERS.STATUS]),
      token: tokenColumn,
      decidedAt: buscarColumna_(headers, [
        CONFIG.SYSTEM_HEADERS.DECIDED_AT,
      ]),
      credentialFileId: buscarColumna_(headers, [
        CONFIG.SYSTEM_HEADERS.CREDENTIAL_FILE_ID,
      ]),
      observation: buscarColumna_(headers, [
        CONFIG.SYSTEM_HEADERS.OBSERVATION,
      ]),
    },
  };
}

function registrarResultado_(
  sheet,
  row,
  columns,
  status,
  credentialFileId,
  observation,
) {
  sheet.getRange(row, columns.status).setValue(status);
  sheet.getRange(row, columns.decidedAt).setValue(new Date());
  sheet
    .getRange(row, columns.credentialFileId)
    .setValue(credentialFileId || '');
  sheet.getRange(row, columns.observation).setValue(observation || '');
  SpreadsheetApp.flush();
}

function leerFila_(sheet, row) {
  const headers = obtenerEncabezados_(sheet);
  const displayValues = sheet
    .getRange(row, 1, 1, headers.length)
    .getDisplayValues()[0];
  const result = {};
  headers.forEach((header, index) => {
    if (header) result[header] = displayValues[index];
  });
  return result;
}

function obtenerEncabezados_(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map((value) => String(value).trim());
}

function buscarColumna_(headers, aliases) {
  const normalized = headers.map(normalizarClave_);
  for (const alias of aliases) {
    const index = normalized.indexOf(normalizarClave_(alias));
    if (index >= 0) return index + 1;
  }
  throw new Error('No se encontró la columna: ' + aliases.join(' / '));
}

function obtenerCampo_(response, aliases) {
  const keyMap = {};
  Object.keys(response).forEach((key) => {
    keyMap[normalizarClave_(key)] = key;
  });
  for (const alias of aliases) {
    const originalKey = keyMap[normalizarClave_(alias)];
    if (originalKey && String(response[originalKey]).trim()) {
      return response[originalKey];
    }
  }
  return '';
}

function obtenerCampoRequerido_(response, aliases) {
  const value = obtenerCampo_(response, aliases);
  if (!String(value).trim()) {
    throw new Error(
      'Falta un dato obligatorio en la respuesta: ' + aliases[0] + '.',
    );
  }
  return value;
}

function validarConfiguracion_() {
  if (
    !CONFIG.ADMIN_EMAIL ||
    !String(CONFIG.ADMIN_EMAIL).includes('@')
  ) {
    throw new Error('Configura ADMIN_EMAIL en Config.gs.');
  }
  if (
    !CONFIG.SENDER_EMAIL ||
    !String(CONFIG.SENDER_EMAIL).includes('@')
  ) {
    throw new Error('Configura SENDER_EMAIL en Config.gs.');
  }
  if (
    !CONFIG.WEB_APP_URL ||
    CONFIG.WEB_APP_URL.includes('PEGAR_AQUI') ||
    !CONFIG.WEB_APP_URL.endsWith('/exec')
  ) {
    throw new Error(
      'Configura WEB_APP_URL en Config.gs con la URL /exec del despliegue.',
    );
  }
  if (
    !CONFIG.TEMPLATE_IMAGE_FILE_ID ||
    CONFIG.TEMPLATE_IMAGE_FILE_ID.includes('PEGAR_AQUI')
  ) {
    throw new Error(
      'Configura TEMPLATE_IMAGE_FILE_ID en Config.gs con el ID de la imagen subida a Drive.',
    );
  }
}

function paginaResultado_(title, message, ok) {
  const color = ok ? '#137333' : '#b3261e';
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' +
      escaparHtml_(title) +
      '</title></head><body style="margin:0;background:#eef4f7;font-family:Arial,sans-serif;color:#173042">' +
      '<main style="max-width:620px;margin:60px auto;background:white;border-radius:12px;padding:36px;box-shadow:0 8px 30px rgba(11,76,107,.12)">' +
      '<div style="width:52px;height:52px;border-radius:50%;background:' +
      color +
      ';color:white;font-size:32px;line-height:52px;text-align:center">' +
      (ok ? '✓' : '!') +
      '</div>' +
      '<h1 style="font-size:26px;color:' +
      color +
      '">' +
      escaparHtml_(title) +
      '</h1><p style="font-size:17px;line-height:1.55">' +
      escaparHtml_(message) +
      '</p></main></body></html>',
  ).setTitle(title);
}

function paginaConfirmacion_(action, token) {
  const accepting = action === 'aceptar';
  const title = accepting
    ? 'Confirmar aceptación'
    : 'Confirmar rechazo';
  const message = accepting
    ? 'Al confirmar se generará la credencial y se enviará por correo a la persona solicitante.'
    : 'Al confirmar se enviará el correo de rechazo y no se generará ninguna credencial.';
  const color = accepting ? '#137333' : '#b3261e';
  const buttonLabel = accepting
    ? 'Sí, aceptar y enviar'
    : 'Sí, rechazar y notificar';
  const confirmUrl =
    CONFIG.WEB_APP_URL +
    '?action=' +
    encodeURIComponent(action) +
    '&token=' +
    encodeURIComponent(token) +
    '&confirm=1';

  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' +
      escaparHtml_(title) +
      '</title></head><body style="margin:0;background:#eef4f7;font-family:Arial,sans-serif;color:#173042">' +
      '<main style="max-width:620px;margin:60px auto;background:white;border-radius:12px;padding:36px;box-shadow:0 8px 30px rgba(11,76,107,.12)">' +
      '<h1 style="font-size:26px;color:' +
      color +
      '">' +
      escaparHtml_(title) +
      '</h1><p style="font-size:17px;line-height:1.55">' +
      escaparHtml_(message) +
      '</p>' +
      '<div style="margin-top:26px">' +
      '<a href="' +
      escaparAtributo_(confirmUrl) +
      '" style="display:inline-block;border:0;border-radius:6px;background:' +
      color +
      ';color:#fff;padding:13px 22px;font-size:16px;font-weight:bold;text-decoration:none">' +
      escaparHtml_(buttonLabel) +
      '</a>' +
      '</div>' +
      '<p style="margin-top:22px;font-size:13px;color:#5f6368">Podés cerrar esta ventana para cancelar.</p>' +
      '</main></body></html>',
  ).setTitle(title);
}

function botonHtml_(label, url, color) {
  return (
    '<a href="' +
    escaparAtributo_(url) +
    '" style="display:inline-block;margin:0 12px 10px 0;padding:12px 22px;border-radius:6px;background:' +
    color +
    ';color:#fff;text-decoration:none;font-weight:bold">' +
    escaparHtml_(label) +
    '</a>'
  );
}

function construirTextoPlano_(response, acceptUrl, rejectUrl) {
  const lines = Object.keys(response)
    .filter((header) => !esColumnaSistema_(header))
    .map(
      (header) =>
        header + ': ' + formatearValorCorreo_(response[header]),
    );
  return (
    'Nueva solicitud de credencial digital\n\n' +
    lines.join('\n') +
    '\n\nAceptar: ' +
    acceptUrl +
    '\nRechazar: ' +
    rejectUrl
  );
}

function esColumnaSistema_(header) {
  return Object.values(CONFIG.SYSTEM_HEADERS)
    .map(normalizarClave_)
    .includes(normalizarClave_(header));
}

function formatearValorCorreo_(value) {
  return String(value ?? '').trim() || '(sin respuesta)';
}

function formatearDni_(value) {
  const digits = soloDigitos_(value);
  if (!digits) throw new Error('El DNI no contiene dígitos.');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function normalizarClaustro_(value) {
  const compact = normalizarClave_(value).replace(/[^a-z]/g, '');

  if (compact.includes('nodocente')) return 'NODOCENTE';
  if (compact.includes('docente')) return 'DOCENTE';
  if (compact.includes('estudiante') || compact.includes('alumno')) {
    return 'ESTUDIANTE';
  }

  throw new Error(
    'Claustro no reconocido: "' +
      String(value) +
      '". Debe ser Estudiante, Docente o No docente.',
  );
}

function tamanoClaustro_(claustro) {
  return claustro === 'DOCENTE' ? 31 : 27;
}

function soloDigitos_(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function tamanoNombre_(name) {
  const length = String(name).length;
  if (length > 42) return 13;
  if (length > 34) return 15;
  if (length > 25) return 17;
  return 20;
}

function nombreArchivoSeguro_(value) {
  return normalizarEspacios_(String(value))
    .replace(/[\\/:*?"<>|#%{}[\]]/g, '')
    .slice(0, 90);
}

function normalizarEspacios_(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizarClave_(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparHtml_(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escaparAtributo_(value) {
  return escaparHtml_(value);
}

function truncar_(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength
    ? text.slice(0, maxLength - 1) + '…'
    : text;
}
