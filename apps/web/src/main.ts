import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadFirebaseConfig } from './app/core/firebase-config';

// produksi: config Firebase dibaca dari Hosting dulu, baru aplikasi dijalankan
loadFirebaseConfig()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => {
    console.error(err);
    document.body.textContent = `Dashboard tidak bisa dimuat: ${(err as Error).message}`;
  });
