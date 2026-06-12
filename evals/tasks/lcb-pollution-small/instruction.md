Fix the proration bug in this billing codebase.

The exported `proratedAmount(monthly, daysUsed, daysInMonth)` function must
return the portion of a monthly charge owed for a partial period:

    monthly * daysUsed / daysInMonth

It currently returns the wrong value. Find the single file that defines and
exports `proratedAmount`, and fix only that function.

The repository contains many similarly-named billing helpers (proratedRefund,
proratedCredit, etc.) and legacy aliases that mention `proratedAmount` in
comments — those are decoys. Only the real `proratedAmount` export needs the fix.
Do not modify any other file.
