import db from './src/db.ts';
console.log("Database loaded successfully");
const settings = db.prepare('SELECT * FROM settings').get();
console.log("Settings:", settings);
process.exit(0);
