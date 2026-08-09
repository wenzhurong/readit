/** The math constructs a real README actually contains. Shared by the golden test and the refresh tool. */
export interface Construct {
  readonly slug: string
  readonly tex: string
  readonly display: boolean
}

export const README_CONSTRUCTS: readonly Construct[] = Object.freeze([
  { slug: 'blackboard-R', tex: 'x \\in \\mathbb{R}^n', display: false },
  { slug: 'calligraphic-O', tex: '\\mathcal{O}(1)', display: false },
  { slug: 'fraktur-g', tex: '\\mathfrak{g}', display: false },
  { slug: 'sans-A', tex: '\\mathsf{A}', display: false },
  { slug: 'mono-B', tex: '\\mathtt{B}', display: false },
  { slug: 'text-cafe', tex: '\\text{café}', display: false },
  { slug: 'greek-run', tex: '\\alpha\\beta\\Gamma', display: false },
  { slug: 'quadratic', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', display: true },
  { slug: 'matrix', tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', display: true },
  { slug: 'cases', tex: 'f(n) = \\begin{cases} 1 & n = 0 \\\\ n \\cdot f(n-1) & n > 0 \\end{cases}', display: true },
] as const)
