'use strict';
const fs = require('node:fs');
const { abrir, ARQUIVO } = require('./db');

for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(ARQUIVO + sufixo, { force: true });
abrir().close();
console.log(`Banco recriado com dados de demonstração em ${ARQUIVO}`);
