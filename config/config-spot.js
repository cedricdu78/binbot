module.exports = {

    // keep_balance :   How much we keep the money.
    keep_balance: function () { return 0 },

    // mise :           The stake is 4% of your total balance (example for $4000 spot balance, stake of $160)
    // profit :         Percentage of expected gain per purchase on a crypto
    // interval :       Crypto history every 15 minutes over a week
    // median :         Purchase of a crypto if price between -0% and -20% of the average calculated over a week
    // prc :            Percentage difference between the average and the maximum over the week
    // minimalAmount :  Minimal amount for buy with bot
    mise: function () { return 4 },
    profit: function () { return 10 },
    interval: function () { return ['15m', 900] },
    median: function () { return [0, 30] },
    prc: function () { return 10 },
    minimalAmount: function () { return 800 },

    // baseMoney    : base for crypto trading !choose stable coin!
    // feeMoney     : Use BNB for payment fee trading because -25%
    // feeValue     : Fee value with BNB is 0.750 but for security 0.15
    baseMoney: function () { return "USDT" },
    feeMoney: function () { return "BNB" },
    feeValue: function() { return 0.075 },

    // restartTime : Delay before restart bot
    restartTime: function() { return 20000 }
}
