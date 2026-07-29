# Sistema de credencial digital

Automatiza la aprobación de solicitudes recibidas desde Google Forms:

1. Una persona completa el formulario.
2. El administrador recibe un correo con todos los datos y los botones **Aceptar** y **Rechazar**.
3. Al aceptar, se genera una credencial PNG con claustro, nombre, DNI y vencimiento, y se envía al solicitante.
4. Al rechazar, se envía un correo de rechazo sin generar la imagen.

La credencial vence el 31 de marzo siguiente. Por ejemplo, una solicitud aprobada desde el 31/03/2026 hasta el 30/03/2027 vence el 31/03/2027.

## Archivos

- `Codigo.gs`: sistema completo y configuración.
- `appsscript.json`: permisos necesarios para Apps Script.
- `credencial-base.png`: plantilla sin datos personales.

## Campos del formulario

El formulario debe guardar sus respuestas en Google Sheets y mantener estos títulos:

- Correo electrónico
- Apellido/s
- Nombre/s
- DNI
- Claustro
- Legajo (1-11111111/20)
- Celular

En **Claustro** se puede responder `Estudiante`, `Docente` o `No docente`. La credencial mostrará `ESTUDIANTE`, `DOCENTE` o `NODOCENTE`.

## Instalación en otra cuenta o formulario

### 1. Preparar la cuenta

Iniciá sesión con la cuenta de Google que enviará los correos y será propietaria del formulario, la hoja y el script. Subí `credencial-base.png` a su Google Drive.

Abrí la imagen subida y copiá su ID. En una URL como:

```text
https://drive.google.com/file/d/ABC123/view
```

el ID es `ABC123`.

### 2. Abrir Apps Script

Desde la hoja de respuestas del formulario:

1. Entrá en **Extensiones > Apps Script**.
2. Abrí `Código.gs`, borrá su contenido y pegá todo el contenido de `Codigo.gs`.
3. Abrí **Configuración del proyecto**.
4. Activá **Mostrar el archivo de manifiesto appsscript.json**.
5. Abrí `appsscript.json`, borrá su contenido y pegá el archivo de este repositorio.

### 3. Completar la configuración

Al principio de `Codigo.gs`, modificá:

```javascript
ADMIN_EMAIL: 'correo-que-recibe-solicitudes@ejemplo.com',
SENDER_EMAIL: 'correo-que-envia@ejemplo.com',
SENDER_NAME: 'Bienestar Universitario - UNPA UARG',
TEMPLATE_IMAGE_FILE_ID: 'ID_DE_LA_IMAGEN_EN_DRIVE',
```

`SENDER_EMAIL` debe ser la cuenta que ejecuta el script o un alias autorizado en Gmail.

Todavía dejá `WEB_APP_URL` con el texto de ejemplo. Guardá el proyecto.

### 4. Autorizar e instalar

1. En el selector de funciones elegí `autorizarPermisos`.
2. Presioná **Ejecutar** y aceptá los permisos de Google.
3. Elegí `instalarSistema`.
4. Presioná **Ejecutar**.

Esto crea el activador que detecta automáticamente cada nueva respuesta.

### 5. Publicar la aplicación web

1. Presioná **Implementar > Nueva implementación**.
2. Elegí **Aplicación web**.
3. En **Ejecutar como**, seleccioná **Yo**.
4. En **Quién tiene acceso**, seleccioná **Cualquier persona**.
5. Implementá y copiá la URL terminada en `/exec`.
6. Pegala al principio de `Codigo.gs`:

```javascript
WEB_APP_URL: 'https://script.google.com/macros/s/.../exec',
```

7. Guardá.
8. Entrá en **Implementar > Administrar implementaciones**, editá esa misma implementación, elegí **Nueva versión** e implementá nuevamente.

No crees otra aplicación web cada vez que cambies el código: actualizá la existente para conservar la misma URL.

### 6. Probar

Completá el formulario con una dirección de correo propia. Verificá:

- que llegue la solicitud al correo administrador;
- que **Rechazar** envíe el aviso;
- que **Aceptar** genere y envíe el PNG;
- que la hoja registre el estado.

Los botones de correos viejos pueden corresponder a una versión anterior. Para una prueba limpia, enviá una respuesta nueva.

## Cambiar correos y mensajes

Todo se modifica al principio de `Codigo.gs`:

- `ADMIN_EMAIL`: destinatario de las solicitudes.
- `SENDER_EMAIL`: remitente.
- `SENDER_NAME`: nombre visible del remitente.
- `APPROVAL_SUBJECT`: asunto de la solicitud.
- `CREDENTIAL_SUBJECT`: asunto de aceptación.
- `REJECTION_SUBJECT`: asunto de rechazo.
- `CREDENTIAL_MESSAGE`: cuerpo del correo de aceptación.
- `REJECTION_MESSAGE`: cuerpo del correo de rechazo.

Después de cualquier cambio, guardá y publicá una **Nueva versión** de la implementación existente.

## Reutilizar el sistema

Para cada nueva cuenta o formulario se repite la instalación completa. Cada cuenta debe usar su propia copia de la imagen en Drive, su propio proyecto de Apps Script, sus correos y su URL `/exec`.

La plantilla del repositorio no contiene nombres, DNI, fechas ni claustros reales.
