# SALAZAR.xlsx mapping (inspected source, 11 October 2026)

Source was read from Downloads. It is not committed or used as seed data. Seven sheets: INSTRUCTIONS, INPUT DATA, Term 1, Term 2, Term 3, FINAL GRADES, HELPER (hidden). Merged headers mean this is not a flat table.

## Inputs

INPUT DATA: F10 region, F11 division, F13 school ID, F14 school name, F16 school year start (G16 formula for end), F22 teacher, F24 grade, F25 section, F28 subject category, F29 cluster, F30 subject. F39 is other elective title. N11:N60 LRNs and O11:O60 names for male; R11:R60 LRNs and S11:S60 names for female. Empty slots and group labels must be excluded with review. Current source contains 8 male and 17 female named learners, all without LRNs. Names must never be used as automatic identity matches.

## Configuration dependencies

Resolve subject against HELPER J7:AC161: J track, K cluster, L title, N available grade levels. Grade 11 uses P terms, Q units/term, R units/year; grade 12 uses T, U, V. W/X/Y are component percentage weights; AA/AB/AC are ST1/ST2/TE percentages. Selected subject is Life and Career Skills, matched at row 10: 20/50/30 and 30/30/40; grade 11 requires 3 terms, 2 units per term, 6 per year. Do not use cached I selected-grade flags. Resolve grade from raw N values. HELPER G13:G19 contain calculated selected weights and are comparison evidence only.

INPUT DATA F33:F35 are formulas for regular terms/units; H33 is raw starting term. For other electives, F43:F45 component weights, F46:F48 exam weights, F51 term count, F52 units/term, H51 starting term. HELPER F38:G43 maps 11/12/13/21/22/33 to term blocks. The workbook G27 units formula still looks up helper Q/U even for other electives: custom units cannot be assumed authoritative without teacher resolution.

## Term sheets

All three have maxima in row 14. Written raw columns D:M, total N, PS O, WS P. Performance raw Q:Z, total AA, PS AB, WS AC. Exam raw AD/AE/AF; weighted subcomponents AG/AH/AI; exam PS AJ; exam WS AK. Initial grade AL; term grade AM. Male learner slots rows 17:66 map to input rows 11:60 (+6); female rows 68:117 map to input rows 11:60 (+57). Rows 16/67 are group headings. Only raw columns with maxima or scores are assessments; formula totals must never be assessments.

Term 1 maxima: D14:H14 = 45,30,20,28,15; Q14:S14 = 10,16,70; AD14:AF14 = 30,30,60. Other raw maxima blank. Terms 2 and 3 have no entered maxima or scores. All remain applicable and incomplete.

## Exact supported calculations

COUNT(raw)=0 returns blank total; otherwise SUM ignores blanks (zeros count). PS=ROUND(total/SUM(maxima)*100,2); WS=ROUND(PS*componentWeight/100,2). Examination subcomponent=ROUND(raw/max*subweight,2). AJ sums entered subcomponents, divides by SUM(all configured subweights), multiplies by 100, without ROUND. AK=ROUND(AJ*examWeight/100,2). Initial grade adds component WS with no extra rounding and requires both WW and PT results; EX required only when its weight > 0. Missing individual scores can still produce workbook grades; mark these incomplete, never classify them as final failures.

AM uses XLOOKUP(AL,HELPER C7:C47,D7:D47,,1): exact match or next larger MAXIMUM boundary (ceiling), not interval membership or a generic transmutation table. Preserve exact stored boundary numbers; floating Excel table values have tiny binary artifacts. HELPER B is informational minimum; the C lookup controls the result. No match above 100 yields blank. An empty initial grade can be coerced to zero by Excel lookup; application leaves it incomplete and documents this deviation to avoid invented grades.

FINAL GRADES male/female slots use the same rows. C LRN, D name, E/F/G term grades, H final, I descriptor, J remark. E:G require nonempty LRN in C. H requires LRN and COUNT(E:G)=number of terms, then ROUND(SUM(termGrades)*unitsPerTerm/unitsPerYear,0). Missing LRN learners can have term results but final stays provisional until an LRN is provided; generated application IDs are not LRNs. I uses exact lookup HELPER AG7:AG47 to AH7:AH47. J threshold >=75 PASSED else FAILED.

## Provenance, formulas and evidence

Store sheet/address for metadata, learners, maxima, raw scores, configuration tables and cached grade comparisons. XLSX parser is not a calculation engine. Known template formulas are checked against expected signatures; formula inputs or altered formulas block normal grading until resolved. External defined name SUBJECTS points to another workbook; several defined names are #REF!. They affect dropdowns, not supported arithmetic; flag them as informational provenance warnings. Never execute arbitrary formulas/macros. Missing/stale caches are expected. Compare N/O/P, AA/AB/AC, AG:AM and final H/I/J to explicit calculations with cell references, without logging learner records.
