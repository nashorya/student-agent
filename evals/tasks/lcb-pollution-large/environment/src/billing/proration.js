// Subscription proration helpers.
// proratedAmount returns the portion of a monthly charge owed for a partial
// period: monthly * daysUsed / daysInMonth.
function proratedAmount(monthly, daysUsed, daysInMonth) {
  // BUG: off-by-one in the denominator.
  return (monthly * daysUsed) / (daysInMonth + 1);
}

module.exports = { proratedAmount };
