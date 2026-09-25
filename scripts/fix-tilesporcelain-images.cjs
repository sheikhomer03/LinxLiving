"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

async function fetchHubImages(hubUrl) {
  try {
    const res = await fetch(hubUrl);
    if (!res.ok) return null;
    const html = await res.text();
    const imgs = new Set();
    
    const match = html.match(/"data":\s*(\[.*?\])/);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        data.forEach(d => {
           if (d.full) imgs.add(d.full);
           else if (d.img) imgs.add(d.img);
        });
      } catch(e) {}
    }
    
    if (imgs.size > 0) {
      return Array.from(imgs).map(cleanUrl);
    }
  } catch (e) {}
  return null;
}

function cleanUrl(u) {
  return u
    .replace(/\/amasty\/webp\//, "/")
    .replace(/\/cache\/[a-f0-9]+\//, "/")
    .replace(/_([a-z]+)\.webp$/, ".$1");
}

async function main() {
  const { db: primary } = await connectMongo();
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, {
    serverSelectionTimeoutMS: 30000,
  }).asPromise();
  
  const brand = await primary.collection("brands").findOne({ slug: "tiles-porcelain" });
  if (!brand) throw new Error("Tiles Porcelain brand not found");

  const productsCol = conn.db.collection("products");
  const products = await productsCol.find({ brand: brand._id }).toArray();
  
  console.log(`Found ${products.length} products to check...`);
  
  const hubCache = new Map();
  let updated = 0;

  for (const prod of products) {
    let baseName = prod.name.trim();
    const match = baseName.match(/^(.*?)\s*-\s*([\dxXmmcm\s]+)$/i);
    if (match) baseName = match[1].trim();
    
    const hubSlug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const hubUrl = `https://tilesporcelain.co.uk/${hubSlug}`;
    
    let newImages = [];
    
    if (!hubCache.has(hubUrl)) {
      const hubImgs = await fetchHubImages(hubUrl);
      hubCache.set(hubUrl, hubImgs);
      if (hubImgs) console.log(`Fetched ${hubImgs.length} images from hub ${hubUrl}`);
    }
    
    const hubImgs = hubCache.get(hubUrl);
    if (hubImgs && hubImgs.length > 0) {
      newImages = hubImgs;
    } else {
      // Fallback to cleaning the existing images
      newImages = (prod.images || []).map(cleanUrl);
    }
    
    if (newImages.length > 0) {
      await productsCol.updateOne(
        { _id: prod._id },
        { 
          $set: { images: newImages },
          $unset: { shopifyImages: "", shopifyVariantId: "", shopifyProductId: "" } 
        }
      );
      updated++;
    }
  }
  
  console.log(`Successfully updated ${updated} products.`);
  process.exit(0);
}

main().catch(console.error);
