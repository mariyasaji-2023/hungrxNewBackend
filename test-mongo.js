// test-mongo.js
const { MongoClient } = require("mongodb");

const uri = "mongodb+srv://hungrx001:hungrxmongo@newcluster.zyidujk.mongodb.net/hungrxBackend?retryWrites=true&w=majority&appName=newCluster";

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log("✅ Connected successfully!");
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Ping successful!");
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.close();
  }
}

main();