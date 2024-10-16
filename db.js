require('dotenv').config();
const mongoose = require('mongoose');
a= process.env.MONGO_DB_A
console.log(a)
const connectDB = async () => {
  try {
    console.log('Conectando a:', process.env.MONGO_DB_A);  // Para ver qué URI se está utilizando
    await mongoose.connect(process.env.MONGO_DB_A);
    console.log('Conectado a MongoDB');
  } catch (error) {
    console.error('Error de conexión a MongoDB:', error);
    process.exit(1);
  }
};

// Definir esquema y modelo para MongoDB
const ThreadSchema = new mongoose.Schema({
  thread_id: String,
  platform: String,
  username: String,
  timestamp: Date,
  status: String,
});

const Thread = mongoose.model('Thread', ThreadSchema);

module.exports = {
  connectDB,
  Thread  // Exportar el modelo Thread para usarlo en otros archivos
};
