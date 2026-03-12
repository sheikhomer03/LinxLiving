import mongoose from "mongoose";
import { Product } from "../src/models/Product";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/ecommerce-pro";

const TRENDING_PRODUCTS = [
  {
    _id: new mongoose.Types.ObjectId("65e49c7a2f5a2b1a3c4d5e60"),
    name: "Kensington Vanity Unit & Stone Basin 800mm Walnut",
    description:
      "A luxurious walnut vanity unit paired with a pristine stone basin.",
    price: 997.0,
    category: "Vanity",
    images: ["/images/tiles4.jpg"],
    stock: 10,
  },
  {
    _id: new mongoose.Types.ObjectId("65e49c7a2f5a2b1a3c4d5e61"),
    name: "Rotunda Fluted Vanity Unit & Stone Basin 600mm Smoked Oak",
    description:
      "Elegant smoked oak fluted design for a modern bathroom aesthetic.",
    price: 1097.0,
    category: "Vanity",
    images: ["/images/tiles5.jpg"],
    stock: 5,
  },
  {
    _id: new mongoose.Types.ObjectId("65e49c7a2f5a2b1a3c4d5e62"),
    name: "Nero Curved Stone Vanity Unit 600mm",
    description:
      "A striking curved stone unit that makes a bold architectural statement.",
    price: 697.0,
    category: "Vanity",
    images: ["/images/tiles6.jpg"],
    stock: 8,
  },
  {
    _id: new mongoose.Types.ObjectId("65e49c7a2f5a2b1a3c4d5e63"),
    name: "Park Lane Vanity Unit & Stone Basin 800mm Sabbia Grigio Oak",
    description:
      "Classic Sabbia Grigio Oak finish with premium stone functionality.",
    price: 897.0,
    category: "Vanity",
    images: ["/images/tiles1.jpg"],
    stock: 12,
  },
];

const TILE_PRODUCTS = [
  {
    _id: new mongoose.Types.ObjectId("65e49c7a2f5a2b1a3c4d5e64"),
    name: "Calacatta Gold Slab",
    description: "Iconic Italian marble with warm gold veining.",
    price: 450,
    category: "Marble",
    images: ["/images/tiles1.jpg"],
    stock: 20,
  },
  {
    _id: new mongoose.Types.ObjectId("65e49c7a2f5a2b1a3c4d5e65"),
    name: "Emerald Green Mosaic",
    description: "Vibrant green glass mosaics for a lush splashback.",
    price: 120,
    category: "Tiles",
    images: ["/images/tiles2.jpg"],
    stock: 50,
  },
  {
    _id: new mongoose.Types.ObjectId("65e49c7a2f5a2b1a3c4d5e66"),
    name: "Matte Black Hexagon",
    description: "Sleek matte finish hexagon tiles for contemporary flooring.",
    price: 85,
    category: "Ceramic",
    images: ["/images/tiles3.jpg"],
    stock: 100,
  },
];

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);

    await Product.deleteMany({});

    await Product.insertMany([...TRENDING_PRODUCTS, ...TILE_PRODUCTS]);

    process.exit(0);
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  }
}

seed();
