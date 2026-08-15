// Shared workflow catalog — used by the client (UI) and the server (runner).

export type WorkflowStep = {
  key: string;
  title: string;
  description: string;
  /** Persona used for this step. */
  personaId: string;
  /** Prompt template. {{brief}} = user brief, {{prev}} = previous step outputs. */
  prompt: string;
};

export type Workflow = {
  key: string;
  name: string;
  emoji: string;
  tagline: string;
  steps: WorkflowStep[];
};

export const WORKFLOWS: Workflow[] = [
  {
    key: "launch",
    name: "Plan → Build → Deploy → Launch",
    emoji: "🚀",
    tagline: "Take an idea from zero to shipped",
    steps: [
      {
        key: "plan",
        title: "Plan",
        description: "Scope, architecture, and milestones",
        personaId: "swarm",
        prompt:
          "Product brief:\n{{brief}}\n\nProduce a build plan: 1) one-paragraph product definition, 2) target user + core job-to-be-done, 3) MVP feature list (must-have vs later), 4) recommended tech stack with reasons, 5) data model sketch, 6) milestones with rough effort. Be concrete and opinionated.",
      },
      {
        key: "build",
        title: "Build",
        description: "Working scaffold and code",
        personaId: "coder",
        prompt:
          "Brief:\n{{brief}}\n\nApproved plan:\n{{prev}}\n\nBuild the MVP scaffold. Use create_artifact for each significant file (schema, main app code, key components). Explain briefly how the pieces fit and what to run. Real working code only — no pseudocode, no TODO stubs.",
      },
      {
        key: "deploy",
        title: "Deploy",
        description: "Hosting, domain, CI, env vars",
        personaId: "fabian5",
        prompt:
          "Brief:\n{{brief}}\n\nWhat was built:\n{{prev}}\n\nProduce a deployment runbook: recommended host and why, exact step-by-step deploy commands, environment variables needed, custom domain + DNS records, CI pipeline config (as an artifact), monitoring/error tracking, and a pre-launch checklist. Use web_search to confirm current pricing or steps where they may have changed.",
      },
      {
        key: "launch",
        title: "Launch",
        description: "Positioning, copy, launch assets",
        personaId: "marketer",
        prompt:
          "Brief:\n{{brief}}\n\nProduct + deployment context:\n{{prev}}\n\nBuild the launch kit: positioning statement, 3 headline options, landing page copy (as an artifact), Product Hunt / Show HN post, 5 launch tweets, and a cold outreach email template. Punchy and specific to this product.",
      },
      {
        key: "leads",
        title: "Find customers",
        description: "ICP, channels, and a lead list",
        personaId: "researcher",
        prompt:
          "Brief:\n{{brief}}\n\nLaunch context:\n{{prev}}\n\nDefine the ideal customer profile, then use web_search and fetch_url to find REAL, specific prospects that match it (companies, communities, directories, job posts signalling the pain). For each prospect call the save_lead tool with what you found. Finish with a short table of who you saved and the recommended first-touch angle for each.",
      },
    ],
  },
  {
    key: "marketing",
    name: "Marketing campaign",
    emoji: "📣",
    tagline: "Research → positioning → content → outreach",
    steps: [
      {
        key: "research",
        title: "Market research",
        description: "Competitors, audience, and gaps",
        personaId: "researcher",
        prompt:
          "Campaign brief:\n{{brief}}\n\nUse web_search and fetch_url to research: 3-5 real competitors with how they position themselves, the audience's actual language and pain points (forums, reviews, communities), and the positioning gap we can own. Cite every source URL.",
      },
      {
        key: "positioning",
        title: "Positioning",
        description: "Message, angles, and offer",
        personaId: "fugu",
        prompt:
          "Brief:\n{{brief}}\n\nResearch:\n{{prev}}\n\nStake out a sharp, contrarian position. Give: the category we're really in, the enemy we're against, 3 message angles ranked by risk/reward, the offer, and what we're deliberately NOT saying. Name the failure mode of each angle.",
      },
      {
        key: "content",
        title: "Content plan",
        description: "Calendar and ready-to-post assets",
        personaId: "marketer",
        prompt:
          "Brief:\n{{brief}}\n\nPositioning:\n{{prev}}\n\nProduce a 4-week content calendar as an artifact: channel, format, hook, and CTA per post. Then write out the first week's posts in full, ready to publish.",
      },
      {
        key: "outreach",
        title: "Outreach + leads",
        description: "Prospect list and sequences",
        personaId: "researcher",
        prompt:
          "Brief:\n{{brief}}\n\nCampaign so far:\n{{prev}}\n\nFind real prospects with web_search and fetch_url, and save each one with the save_lead tool. Then write a 3-touch outreach sequence (email 1, follow-up, breakup) personalised to the ICP. Cite where each prospect came from.",
      },
    ],
  },
];

export function getWorkflow(key: string | null | undefined): Workflow | null {
  if (!key) return null;
  return WORKFLOWS.find((w) => w.key === key) ?? null;
}
