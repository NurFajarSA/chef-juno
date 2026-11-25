// Harus diimpor PERTAMA di index.ts: setGlobalOptions sebelum fungsi apa pun didefinisikan (ESM hoisting).
import { setGlobalOptions } from 'firebase-functions';
import { REGION } from '@chefjuno/shared';
import { FUNCTIONS_SA } from './params.js';

setGlobalOptions({ region: REGION, serviceAccount: FUNCTIONS_SA });
