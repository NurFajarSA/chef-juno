/** Perintah CLI mesin reviewer. Selama daemon belum dipublish ke npm: node apps/daemon/dist/cli.js (§12.2). */
export const MACHINE_START_COMMAND = 'node apps/daemon/dist/cli.js start';
export const machineLoginCommand = (server: string, code: string) => `node apps/daemon/dist/cli.js login --server ${server} --code ${code}`;
