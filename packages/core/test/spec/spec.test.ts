import examples from './commonmark-0.31.2.json' with { type: 'json' }
import { runSpecSuite } from './harness.js'
import type { SpecExample } from './harness.js'

runSpecSuite('commonmark-0.31.2', examples as SpecExample[], 652)
