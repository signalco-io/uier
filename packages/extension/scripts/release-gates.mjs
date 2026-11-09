import { releaseGate } from './release.mjs';
releaseGate(process.argv[2]);
console.log('Protected browser publishing and native hosted acceptance gates are present.');
