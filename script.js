// extractUsers.js
// Usage:
//   node extractUsers.js                 -> reads users.json (default)
//   node extractUsers.js data.json       -> reads a specific JSON file
//   node extractUsers.js --db            -> reads from MongoDB instead

const fs = require("fs");

// Config for the MongoDB path
const MONGO_CONFIG = {
  uri: "mongodb+srv://hungrx001:hungrxmongo@newcluster.zyidujk.mongodb.net/",
  dbName: "hungerX",
  collectionName: "users",
};

function filterUsers(users) {
  const list = Array.isArray(users) ? users : [users];
  return list
    .filter((u) => (u.timezone || "").startsWith("America/"))
    .map((u) => ({ name: u.name, email: u.email }));
}

function printAndSave(filtered) {
  filtered.forEach((user) => {
    console.log(`Name: ${user.name}, Email: ${user.email}`);
  });
  fs.writeFileSync("extracted_users.json", JSON.stringify(filtered, null, 2));
  console.log(`\nSaved ${filtered.length} user(s) to extracted_users.json`);
}

async function fromMongo() {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(MONGO_CONFIG.uri);
  try {
    await client.connect();
    const collection = client
      .db(MONGO_CONFIG.dbName)
      .collection(MONGO_CONFIG.collectionName);

    const results = await collection
      .find({ timezone: { $regex: "^America/" } })
      .project({ email: 1, name: 1, _id: 0 })
      .toArray();

    printAndSave(results.map((u) => ({ name: u.name, email: u.email })));
  } finally {
    await client.close();
  }
}

function fromJsonFile(path) {
  const raw = fs.readFileSync(path, "utf-8");
  const data = JSON.parse(raw);
  printAndSave(filterUsers(data));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--db")) {
    await fromMongo();
  } else {
    const path = args.find((a) => !a.startsWith("--")) || "users.json";
    fromJsonFile(path);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});