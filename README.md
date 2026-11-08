<div align="center">

# ChatLens

**Upload a WhatsApp chat export and get chat statistics plus an AI-written relationship report.**

![Status](https://img.shields.io/badge/status-in%20development-d29922?style=flat-square&labelColor=0d1117)
![AI providers](https://img.shields.io/badge/AI-Gemini%20%7C%20Claude%20%7C%20OpenRouter-1f6feb?style=flat-square&labelColor=0d1117)

</div>

---

## Overview

ChatLens is a web app that turns an exported WhatsApp chat into insights. You upload the `.txt` export, and ChatLens shows statistics about the conversation and generates an AI-written report on the relationship between the people in it.

> **Status: in development.** This repository has just been created. The features below are planned and not yet implemented.

## Problem Statement

Group and personal chats hold years of conversation, but there's no easy way to see patterns in them: who talks most, when people are active, how the tone has changed. ChatLens makes those patterns visible and adds an AI summary that puts them into words.

## Planned Features

- Upload a WhatsApp chat export (`.txt`)
- Chat statistics: messages per person, activity over time, most active hours and days, common words and emojis
- AI-written relationship report based on the chat
- Choice of AI provider: Google Gemini, Anthropic Claude or OpenRouter

## Privacy

Chat exports contain personal conversations. API keys and other secrets will be kept in environment variables and never committed to this repository (see `.gitignore`).

## Author

**Mohammed Shamsul Qhadri Shareef**
GitHub: [@MohammedShareef3527](https://github.com/MohammedShareef3527)
