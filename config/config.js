module.exports = {

    // keep_balance :   How much we keep the money.
    // noOrder :        Returns cryptos that have no order and whose value is greater than or equal to 1
    // marketPrc :      The market is bearish when the percentage of buyable crypto is greater than 20%
    // onlyShort :      The bot only buys when the market is detected as bearish
    keep_balance: function () { return 0 },
    noOrder: function () { return 1 },
    marketPrc: function () { return 10 },
    onlyShort: function () { return false },

    // mise :       The stake is 4% of your total balance (example for $4000 spot balance, stake of $160)
    // profit :     Percentage of expected gain per purchase on a crypto
    // interval :   Crypto history every 15 minutes over a week
    // median :     Purchase of a crypto if price between -0% and -20% of the average calculated over a week
    // prc :        Percentage difference between the average and the maximum over the week
    mise: function () { return 4 },
    profit: function () { return 10 },
    interval: function () { return ['15m', 673] },
    median: function () { return [5, 20] },
    prc: function () { return 10 },

    // baseMoney    : base for crypto trading !choose stable coin!
    // baseSymbol   : Currency symbol used
    // feeMoney     : Use BNB for payment fee trading because -25%
    // feeValue     : Fee value with BNB is 0.750 but for security 0.15
    baseMoney: function () { return "USDT" },
    baseSymbol: function () { return "$" },
    feeMoney: function () { return "BNB" },
    feeValue: function() { return 0.15 },

    // colResume :  Column name in console output
    // colCrypto :  Column name in console output
    // refresh :    We wait 20s before relaunching the bot (in ms)
    colResume: function () { return ["Placed", "Current", "Target"] },
    colCrypto: function () { return ["Currencies", "Available", "Total", "Rapport", "Marché", "baissier", "haussier"] },
    refresh: function () { return 20000 },
}