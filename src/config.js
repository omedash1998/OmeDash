// src/config.js
require('dotenv').config && require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'omedash-a435a',
};
