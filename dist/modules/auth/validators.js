"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Joi = require('joi');
const { ROLES } = require('./constants');
// Schema cho đăng ký user
const registerSchema = {
    body: Joi.object({
        username: Joi.string().max(50).required(),
        password: Joi.string().min(6).max(255).required(),
        full_name: Joi.string().max(100).required(),
        email: Joi.string().email().max(100),
        phone: Joi.string().max(20)
    })
};
// Schema cho đăng nhập
const loginSchema = {
    body: Joi.object({
        email: Joi.string()
            .email()
            .required()
            .label('Email'),
        password: Joi.string()
            .required()
            .label('Mật khẩu')
    })
};
module.exports = {
    registerSchema,
    loginSchema
};
