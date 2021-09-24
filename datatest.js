const fs = require('fs');

const datasource = {}
fs.readdirSync('./lib/assets').forEach(v => {
    JSON.parse(fs.readFileSync('./lib/assets/' + v, 'utf8')).forEach(k => {
        if (datasource[k[0]] === undefined)
            datasource[k[0]] = {}

        datasource[k[0]][v.replace('.json','')] = [Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4])]
    })

    console.log("Loading file... " + v)
})

let datasourceKeys = Object.keys(datasource).map(i => Number(i)).sort()

function simulator(available, config_mise, config_median, config_prc, config_profit, config_available, depot, stop, start) {
    let orders = {}
    let nbSell = 0

    const rapport = []

    datasourceKeys.forEach(time => {
        if (new Date(time).getDate() === 1 && new Date(time).getHours() === 0 && new Date(time).getMinutes() === 0) {
            available += depot
        }

        let capital = 0
        let ordersKeys = Object.keys(orders)
        const data = datasource[time]
        ordersKeys.forEach(o => {
            const value = data[o]
            if (value !== undefined && value[0] >= orders[o].sellPrice) {
                const price = value[0] * orders[o].volume
                available += price - (price * 0.2 / 100)
                delete orders[o]
                nbSell++
            } else {
                if (value !== undefined)
                    orders[o].priceNow = value[0]
                else orders[o].priceNow = orders[o].price

                orders[o].prc = ((orders[o].priceNow - orders[o].price) / orders[o].price) * 100
                capital += orders[o].priceNow * orders[o].volume
            }
        })

        const symbols = Object.keys(data).filter(k => data[k][3] >= 600 && orders[k] === undefined
            && data[k][1] * (100 - config_median[0]) / 100 >= data[k][0]
            && data[k][1] * (100 - config_median[1]) / 100 <= data[k][0]
            && data[k][0] > 0
            && ((data[k][2] - data[k][1]) / data[k][1] * 100) >= config_prc)

        capital += available
        if (symbols.length >= config_available) {
            const mise = capital * config_mise / 100
            symbols.slice(0, Number(String(available / mise).split('.')[0])).forEach(k => {
                orders[k] = { symbol : k, price: data[k][0], sellPrice: data[k][0] * (config_profit / 100 + 1),
                    volume: mise / data[k][0], date: new Date(time).toISOString() }
                available -= data[k][0] * orders[k].volume
            })
        }

        if (new Date(time).getHours() === 0 && new Date(time).getMinutes() === 0) {
            rapport.push({ x: time, y: capital})
        }
    })

    console.log(
        "            {\n" +
        "                type:\"line\",\n" +
        "                axisYType: \"secondary\",\n" +
        "                name: \"Profit " + config_profit  + "% | Mise " +  config_mise + "% | Stop " +  stop + " | Median " +  config_median[0] + "% | Prc " +  config_prc + "%\",\n" +
        "                showInLegend: false,\n" +
        "                markerSize: 0,\n" +
        "                yValueFormatString: \"$#,###\",\n" +
        "                dataPoints: [")

    rapport.forEach(x => console.log("                    { x: new Date(" + x.x + "), y: " + x.y + " },"))

    console.log(
        "                ]\n" +
        "            },")
}

simulator(2000, 0, [0, 0], 0, 0, 0, 2000)

simulator(2000, 4, [-5, 30], 10, 10, 0, 2000)

