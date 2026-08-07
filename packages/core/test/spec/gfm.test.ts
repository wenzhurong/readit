import examples from './gfm-0.29.json' with { type: 'json' }
import { runSpecSuite } from './harness.js'
import type { SpecExample } from './harness.js'

runSpecSuite('gfm-0.29', examples as SpecExample[], 672)
