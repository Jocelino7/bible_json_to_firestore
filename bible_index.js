// indexer.js
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- CONFIGURAÇÃO ---
const serviceAccount = require('./bible_ai_service_account.json');
const jsonFolderPath = path.join(__dirname, './json');
// 1. Importa o objeto com todos os seus arrays de stopwords do arquivo stopwords.js
const allStopwordsArrays = require('./stopwords.js');

// --- INICIALIZAÇÃO DO FIREBASE (COM CORREÇÃO) ---
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin inicializado com sucesso.');
}
const db = admin.firestore();

/**
 * @description Converte os arrays de stopwords importados em Sets para performance.
 * @param {Object.<string, string[]>} stopwordArrays - O objeto com códigos de idioma e arrays.
 * @returns {Object.<string, Set<string>>} Um objeto mapeando códigos de idioma para um Set de stopwords.
 */
function createStopwordSets(stopwordArrays) {
    const allStopwordSets = {};
    console.log('Carregando constantes de stopwords...');
    for (const langCode in stopwordArrays) {
        allStopwordSets[langCode] = new Set(stopwordArrays[langCode]);
        console.log(`- Stopwords para '${langCode}' carregadas: ${allStopwordSets[langCode].size} palavras.`);
    }
    console.log('Todos os stopwords foram carregados.\n');
    return allStopwordSets;
}

async function main() {
    try {
        const searchIndex = {};
        // 2. Prepara os Sets de stopwords a partir das constantes importadas
        const allStopwords = createStopwordSets(allStopwordsArrays);
        const files = fs.readdirSync(jsonFolderPath);

        for (const file of files) {
            if (file === 'index.json' || !file.endsWith('.json')) {
                continue;
            }

            const versionId = file.replace('.json', '');
            const langCode = versionId.substring(0, 2);
            const currentStopwords = allStopwords[langCode] || new Set();

            console.log(`Indexando versão: ${versionId} (usando stopwords de '${langCode}')`);

            const filePath = path.join(jsonFolderPath, file);

            // 3. Lógica para remover caracteres invisíveis (BOM)
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const cleanContent = fileContent.replace(/^\uFEFF/, '');
            const bibleData = JSON.parse(cleanContent);

            for (const book of bibleData) {
                for (const chapterNum in book.chapters) {
                    const verses = book.chapters[chapterNum];
                    for (let i = 0; i < verses.length; i++) {
                        const verseNum = i + 1;
                        const verseText = verses[i];
                        const location = `${versionId}/${book.abbrev}/${chapterNum}/${verseNum}`;

                        const cleanedText = verseText.toLowerCase().replace(/[^a-zà-ú\s]/g, '');
                        const words = [...new Set(cleanedText.split(/\s+/))];

                        for (const word of words) {
                            if (word && !currentStopwords.has(word) && word.length > 2) {
                                if (!searchIndex[word]) {
                                    searchIndex[word] = [];
                                }
                                searchIndex[word].push(location);
                            }
                        }
                    }
                }
            }
        }

        console.log(`\nIndexação em memória concluída. Total de palavras únicas a serem salvas: ${Object.keys(searchIndex).length}.`);
        console.log('Iniciando envio para o Firestore em lotes...');

        // Lógica de envio para o Firestore (sem alterações)
        const batchSize = 100;
        const words = Object.keys(searchIndex);
        let batch = db.batch();
        let batchCount = 0;
        const totalBatches = Math.ceil(words.length / batchSize);

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const docRef = db.collection('search_index').doc(word);
            batch.set(docRef, { locations: searchIndex[word] });
            batchCount++;

            if (batchCount === batchSize || i === words.length - 1) {
                let success = false;
                let attempts = 0;
                while (!success && attempts < 3) {
                    try {
                        await batch.commit();
                        success = true; // Succeeded, exit the while loop
                        console.log(`Lote ${Math.ceil((i + 1) / batchSize)} de ${totalBatches} enviado.`);
                    } catch (e) {
                        attempts++;
                        // Error code 4 is DEADLINE_EXCEEDED
                        if (e.code === 4 && attempts < 3) {
                            console.warn(`-- Lote falhou por timeout (tentativa ${attempts}), tentando novamente em 5 segundos...`);
                            await new Promise(resolve => setTimeout(resolve, 5000)); // Longer wait on retry
                        } else {
                            throw e; // If it's another error or max retries reached, re-throw to stop the script
                        }
                    }
                }
                console.log(`Lote ${Math.ceil((i + 1) / batchSize)} de ${totalBatches} enviado.`);
                batch = db.batch();
                batchCount = 0;
                await new Promise(resolve => setTimeout(resolve, 300));

            }
        }

        console.log('\n✅ Processo concluído! Seu índice de busca multilíngue foi populado no Firestore.');

    } catch (error) {
        console.error('❌ Ocorreu um erro durante o processo:', error);
    }
}

main();