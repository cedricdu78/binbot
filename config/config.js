module.exports = {

    // keep_balance :   Combien on garde d'argent de côté de côté.
    // noOrder :        retourne les cryptos qui n'ont pas d'ordre et dont la valeurs est supérieur ou égale à 1
    // marketPrc :      Le marché est baissié quand le pourentage de crypto achetable est supérieur à 20%
    // onlyShort :      Le bot n'achète que quand le marché est detecter comme baissier
    keep_balance: function () { return 0 },
    noOrder: function () { return 1 },
    marketPrc: function () { return 20 },
    onlyShort: function () { return false },

    // mise :       la mise est de 4% de votre solde total (exemple pour 4000$ de solde spot, mise de 160$)
    // profit :     10% de gain (30% = 130, 50% = 150, 120% = 220 ...)
    // interval :   Historique de la crypto toutes les 15mins sur une semaine
    // median :     Achat d'une crypto si prix compris entre -0% et -20% de la moy calculé sur une semaine
    // prc :        pourcentage de différence entre le minimum et le max sur la semaine
    // prc_m :       pourcentage de différence entre le minimum et la moyenne sur la semaine
    mise: function () { return 4 },
    profit: function () { return 110 },
    interval: function () { return ['15m', 673] },
    median: function () { return [0, 20] },
    prc: function () { return 10  },
    prc_m: function () { return 10 },

    // baseMoney    : USDT is base for trading crypto (is stablecoin)
    // baseSymbol   : Symbol de la monney utilisé
    // feeMoney     : use BNB for payement fee trading because -50%
    // feeValue     : fee value with BNB is 0.750 but for security 0.15
    baseMoney: function () { return "USDT" },
    baseSymbol: function () { return "$" },
    feeMoney: function () { return "BNB" },
    feeValue: function() { return 0.15 },

    // colResume :  column name in console output
    // colCrypto :  column name in console output
    // refresh :    20s avant de relancer le bot (en ms)
    colResume: function () { return ["Placed", "Current", "Target"] },
    colCrypto: function () { return ["Currencies", "Available", "Total", "Rapport", "Marché", "baissier", "haussier"] },
    refresh: function () { return 20000 },
}