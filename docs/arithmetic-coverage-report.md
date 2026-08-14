# Grade 1 arithmetic coverage report

Generated against curriculum version 1 and generator `g1-v3`.

## Summary

| Dimension | Counts |
| --- | --- |
| Grade | G1: 24 |
| Tier | core: 22; stretch: 2 |
| Domain | addition: 12; subtraction: 6; multiplication: 3; division: 3 |
| Mastery profile | CONCEPT: 4; FACT: 6; MENTAL: 10; ALGO_SHORT: 4 |
| Difficulty definitions | 96 (four per skill) |
| Critical structural coverage keys | 76 |
| Explicit finite fact identities | 230 (commuted multiplication is one mastery fact) |
| Stable canonical generator fixtures | 288 (12 per skill) |
| Applicable pinned G1 boundary fixtures | 2 (9 + 1; 99 + 1) |

## Skill inventory

| Skill | Tier | Domain | Profile | Generator | Coverage keys |
| --- | --- | --- | --- | --- | --- |
| G1-AS-01 | core | addition | CONCEPT | part-whole | total_0_to_2, total_3_to_5, zero_part |
| G1-AS-02 | core | addition | CONCEPT | part-whole | total_6_to_9, complement_to_10, zero_part |
| G1-AS-03 | core | addition | FACT | addition-fact | zero_addend, doubles, mixed_fact |
| G1-AS-04 | core | subtraction | FACT | subtraction-fact | subtract_zero, subtract_all, mixed_fact |
| G1-AS-05 | core | addition | MENTAL | addition-fact | make_ten, doubles, near_doubles |
| G1-AS-06 | core | subtraction | MENTAL | subtraction-fact | no_decade_crossing, decade_crossing, subtract_zero |
| G1-AS-07 | core | addition | MENTAL | mixed-within-20 | addition, subtraction, result_10_or_20 |
| G1-AS-08 | core | addition | MENTAL | three-addends | contains_zero, make_ten_pair, no_make_ten_pair |
| G1-AS-09 | core | addition | MENTAL | addition-fact | zero_addend, low_ones_sum, high_ones_sum |
| G1-AS-10 | core | addition | MENTAL | addition-fact | result_20_to_49, result_50_to_89, result_90_to_100 |
| G1-AS-11 | core | subtraction | MENTAL | subtraction-fact | subtract_zero, equal_ones, positive_ones_result |
| G1-AS-12 | core | subtraction | MENTAL | subtraction-fact | minuend_ends_zero, small_difference, large_minuend |
| G1-AS-13 | core | addition | MENTAL | place-value-change | addition, subtraction, result_ends_zero |
| G1-AS-14 | core | addition | ALGO_SHORT | two-digit-addition | ones_sum_zero_to_four, ones_sum_five_to_nine, result_contains_zero |
| G1-AS-15 | core | addition | ALGO_SHORT | two-digit-addition | ones_regroup, new_hundred_regroup, sum_near_100 |
| G1-AS-16 | core | subtraction | ALGO_SHORT | two-digit-subtraction | zero_ones_result, result_contains_zero, ordinary_difference |
| G1-AS-17 | core | subtraction | ALGO_SHORT | two-digit-subtraction | minuend_ends_zero, small_difference, ordinary_difference |
| G1-AS-18 | core | addition | MENTAL | missing-term | missing_addend, missing_minuend, missing_subtrahend |
| G1-M-01 | core | multiplication | CONCEPT | multiplication-model | equal_groups, array, repeated_addition |
| G1-M-02 | core | multiplication | FACT | multiplication-fact | row_2, row_5, row_10, focus_factor_left, focus_factor_right |
| G1-D-01 | core | division | CONCEPT | division-model | sharing, grouping, zero_dividend |
| G1-D-02 | core | division | FACT | division-fact | divisor_2, divisor_5, divisor_10 |
| G1-M-03 | stretch | multiplication | FACT | multiplication-fact | row_2, row_5, row_10, focus_factor_left, focus_factor_right |
| G1-D-03 | stretch | division | FACT | division-fact | divisor_2, divisor_5, divisor_10 |

The automated 24,000-instance sweep observes every required key, all four
bands for every skill, and substantial diversity without demanding 1,000
unique instances from small finite fact families.
