import align from './align.mjs';
import archiving from './archiving.mjs';
import deleting from './deleting.mjs';
import editing from './editing.mjs';
import nesting from './nesting.mjs';
import persistence from './persistence.mjs';
import project from './project.mjs';
import readiness from './readiness.mjs';

export const SCENARIOS = [
  readiness,
  editing,
  nesting,
  project,
  align,
  deleting,
  archiving,
  persistence,
];
