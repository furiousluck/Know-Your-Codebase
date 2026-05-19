import mongoose from 'mongoose';

export async function connectDb() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn('MONGODB_URI is not set. Using in-memory store.');
    return false;
  }

  try {
    await Promise.race([
      mongoose.connect(uri, {
        serverSelectionTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 8000),
        connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 8000),
        socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || 20000),
        family: 4
      }),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('MongoDB connection timed out before startup.')),
          Number(process.env.MONGODB_STARTUP_TIMEOUT_MS || 10000)
        );
      })
    ]);
    console.log('MongoDB connected');
    return true;
  } catch (error) {
    await mongoose.disconnect().catch(() => {});
    console.warn(`MongoDB unavailable: ${error.message}. Using in-memory store.`);
    return false;
  }
}
