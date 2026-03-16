import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const ghPagesBase = repoName ? `/${repoName}/` : '/Gemini-Live-Agent-Challenge/';

export default defineConfig({
    // GitHub Pages project sites are served from /<repo>/, not /
    base: process.env.GITHUB_ACTIONS ? ghPagesBase : '/',
});
