import "dotenv/config";

const user = encodeURIComponent("tester@hocmai.vn");
const pass = encodeURIComponent("!@HHHuiw#123GH!!*+2026++");

console.log(user);
console.log(pass);
console.log(`mysql://${user}:${pass}@42.115.41.6:3306/livestream`);

// console.log(process.env.DATABASE_URL);

