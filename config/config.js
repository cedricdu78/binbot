module.exports = {
    interval: function () {
        return ['15m', 673] // Historique de la crypto toutes les 15mins sur une semaine
    },
    median: function () {
        return [0, 20] // Achat d'une crypto si prix compris entre -0% et -20% de la moy calculé sur une semaine
    },
    profit: function () {
        return 110 // 10% de gain (30% = 130, 50% = 150, 120% = 220 ...)
    },
    keep_balance: function () {
        return 0 // Combien on garde d'argent de côté de côté.
    },
    refresh: function () {
        return 20000 // 20s avant de relancer le bot (en ms)
    },
    baseMoney: function () {
        return "USDT" // USDT is base for trading crypto (is stablecoin)
    },
    baseSymbol: function () {
        return "$" // Symbol de la monney utilisé
    },
    feeMoney: function () {
        return "BNB" // use BNB for payement fee trading because -50%
    },
    noOrder: function () {
        return 1 // retourne les cryptos qui n'ont pas d'ordre et dont la valeurs est supérieur ou égale à 1$
    }
}