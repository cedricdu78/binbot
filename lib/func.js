module.exports = {

    // Retourne la moyenne des valeurs d'une liste
    lAvg: function (arr) {
        return arr.reduce((p, c) => p + c, 0) / arr.length;
    },

    // Returne une date au format string
    getDate: function (date = new Date()) {
        return date.getFullYear() + "-"
            + (String(date.getUTCMonth()).length === 1 ? ("0" + (date.getMonth() + 1)) : (date.getMonth() + 1)) + "-"
            + (String(date.getDate()).length === 1 ? ("0" + date.getDate()) : date.getDate()) + " "
            + (String(date.getHours()).length === 1 ? ("0" + date.getHours()) : date.getHours()) + "-"
            + (String(date.getMinutes()).length === 1 ? ("0" + date.getMinutes()) : date.getMinutes()) + "-"
            + (String(date.getSeconds()).length === 1 ? ("0" + date.getSeconds()) : date.getSeconds());
    },

    // Retourne un objet Order
    order: function (currency, volume, price, stopLoss, openValue, nowValue, timestamp, plusValue) {
        const order = Object.create(null)
        order.currency = currency
        order.volume = Number(volume)
        order.price = Number(price)
        order.openValue = Number(openValue)
        order.nowValue = Number(nowValue)
        order.WantValue = Number(stopLoss)
        order.date = this.getDate(new Date(timestamp))
        order.plusValue = Number(Number(plusValue).toFixed(2))
        return order
    }
}