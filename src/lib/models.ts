// Shared model catalog — every id here is verified available on the AI gateway.

export type ChatModel = {
  id: string;
  name: string;
  vendor: "Google" | "OpenAI";
  blurb: string;
};

export const DEFAULT_MODEL = "google/gemini-3.6-flash";

export const CHAT_MODELS: ChatModel[] = [
  {
    id: "google/gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    vendor: "Google",
    blurb: "Fast, capable default — best all-rounder",
  },
  {
    id: "google/gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    vendor: "Google",
    blurb: "Previous-gen flash, very fast",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    vendor: "Google",
    blurb: "Cheapest and quickest for simple turns",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    vendor: "Google",
    blurb: "Deep reasoning on hard problems",
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    vendor: "Google",
    blurb: "Long-context analysis",
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    vendor: "Google",
    blurb: "Stable, well-tested workhorse",
  },
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    vendor: "OpenAI",
    blurb: "OpenAI's strongest general model",
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    vendor: "OpenAI",
    blurb: "Strong reasoning, slightly cheaper",
  },
  {
    id: "openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    vendor: "OpenAI",
    blurb: "Fast OpenAI option for everyday chat",
  },
  {
    id: "openai/gpt-5",
    name: "GPT-5",
    vendor: "OpenAI",
    blurb: "Classic GPT-5",
  },
  {
    id: "openai/gpt-5-mini",
    name: "GPT-5 Mini",
    vendor: "OpenAI",
    blurb: "Lightweight GPT-5",
  },
];

export const ALLOWED_MODEL_IDS = new Set(CHAT_MODELS.map((m) => m.id));

export function getModel(id: string | null | undefined): ChatModel {
  return CHAT_MODELS.find((m) => m.id === id) ?? CHAT_MODELS[0];
}
