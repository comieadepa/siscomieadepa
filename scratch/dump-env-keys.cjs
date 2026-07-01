const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
for (const key in process.env) {
  if (process.env[key]) {
    console.log(`${key}: length ${process.env[key].length}`);
  }
}
