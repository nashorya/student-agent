#!/usr/bin/env node
import { ArchiveService } from '../src/archive/service.js';

const result = await new ArchiveService({
  root: process.cwd(),
  config: { dashboardPath: 'docs/dashboard.html' },
}).build();

console.log(JSON.stringify({
  dashboardPath: result.dashboardPath,
  validation: result.validation,
  counts: {
    timeline: result.project.timeline.length,
    adrs: result.project.adrs.length,
    bugs: result.project.bugs.length,
    evidence: result.project.evidence.length,
  },
}, null, 2));
