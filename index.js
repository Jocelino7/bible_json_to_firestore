const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- Configuração ---
const serviceAccount = require('./bible_ai_service_account.json');
const jsonFolderPath = path.join(__dirname, './json'); // Garanta que a pasta se chame 'json'

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Função auxiliar para remover o BOM
function readAndCleanFile(filePath) {
  let fileContent = fs.readFileSync(filePath, 'utf8');
  if (fileContent.charCodeAt(0) === 0xFEFF) {
    fileContent = fileContent.slice(1);
  }
  return JSON.parse(fileContent);
}

async function uploadData() {
  try {
    // --- TAREFA 1: Processar o index.json e criar o catálogo 'versions' ---
    console.log("Iniciando Tarefa 1: Upload do catálogo de versões...");
    const indexPath = path.join(jsonFolderPath, 'index.json');
    if (fs.existsSync(indexPath)) {
      const indexData = readAndCleanFile(indexPath);
      const versionsBatch = db.batch();

      for (const languageInfo of indexData) {
        const lang = languageInfo.language;
        for (const versionInfo of languageInfo.versions) {
          const versionRef = db.collection('versions').doc(versionInfo.abbreviation);
          versionsBatch.set(versionRef, {
            language: lang,
            name: versionInfo.name
          });
        }
      }
      await versionsBatch.commit();
      console.log("✅ Catálogo de versões enviado com sucesso para a coleção 'versions'!");
    } else {
      console.warn("Aviso: arquivo 'index.json' não encontrado. Pulando a criação do catálogo.");
    }

    // --- TAREFA 2: Processar os arquivos de Bíblia e criar a coleção 'translations' ---
    console.log("\nIniciando Tarefa 2: Upload dos textos da Bíblia...");
    const files = fs.readdirSync(jsonFolderPath).filter(file => file.includes('_') && file.endsWith('.json'));

    for (const file of files) {
      const langCode = path.basename(file, '.json');
      console.log(`Processando: ${langCode}`);
      
      const filePath = path.join(jsonFolderPath, file);
      const bibleData = readAndCleanFile(filePath);
      
      const bibleBatch = db.batch();
      const translationRef = db.collection('translations').doc(langCode);
      // Cria o documento da tradução para garantir que ele exista
      bibleBatch.set(translationRef, { name: langCode, lastUpdated: new Date() });

      for (const book of bibleData) {
        if (book && book.abbrev) {
            const bookRef = translationRef.collection('books').doc(book.abbrev);
            
            const chaptersMap = {};
            book.chapters.forEach((chapterVerses, index) => {
              const chapterNumber = (index + 1).toString();
              chaptersMap[chapterNumber] = chapterVerses;
            });

            const bookData = {
              name: book.name || book.book,
              chapters: chaptersMap
            };
            bibleBatch.set(bookRef, bookData);
        }
      }
      
      await bibleBatch.commit();
      console.log(`✅ ${langCode} enviado com sucesso!`);
    }

    console.log("\n🎉 Processo de upload concluído!");

  } catch (error) {
    console.error("ERRO DURANTE O UPLOAD:", error);
  }
}

// Executa o script
uploadData();