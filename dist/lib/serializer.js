"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeBigInt = void 0;
const serializeBigInt = (data) => JSON.parse(JSON.stringify(data, (_, value) => typeof value === "bigint" ? value.toString() : value));
exports.serializeBigInt = serializeBigInt;
