import os
import json
from datetime import datetime
from operator import itemgetter
from random import *

print("Loading dataset ... ")
datasource = json.load(open('./lib/assets/data.json', 'r'))
datasource = {k: datasource[k] for k in sorted(datasource)}
print("Loading dataset OK")

def simulator(available, config_mise, config_median, config_prc, config_profit, config_stoploss, depot, startDate, endDate):
    orders = {}
    nbSell = 0
    nbLoss = 0
    prev_capital = 1
    investissement = available

    rapport = []

    symbol_dead = set()

    max_capital = None

    nbSellDaily = 0
    nbLossDaily = 0

    for timestamp, datas in datasource.items():

        date_now = datetime.fromtimestamp(int(timestamp) / 1000)

        if date_now < startDate or date_now > endDate:
            continue

        if date_now.day == 1 and date_now.hour == 8 and date_now.minute == 15:
            available += depot
            investissement += depot
            #print(f"Deposit {depot} USDT")

        capital = available
        tickers = {}
        for data in datas:
            tickers[data['symbol']] = float(data['price'])

        #print('CAPI capital ' + str(capital) + ' available ' + str(available))
        for symbol, data in orders.items():
            if not symbol in tickers:
                symbol_dead.add(symbol)
                continue
            elif symbol in symbol_dead:
                symbol_dead.remove(symbol)

            if tickers[symbol] >= data['sellPrice']:
                capital += (data['sellPrice'] * data['volume'])
                #print('CAPI 2 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' sell ' + str(data['sellPrice'] * data['volume']))
            elif tickers[symbol] <= data['limitPrice']:
                capital += (data['limitPrice'] * data['volume'])
                #print('CAPI 2 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' sell ' + str(data['limitPrice'] * data['volume']))
            else:
                capital += tickers[symbol] * data['volume']
                #print('CAPI 2 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' keep ' + str(tickers[symbol] * data['volume']))

        #print('ORDER capital ' + str(capital) + ' available ' + str(available))
        orders_try = orders.copy()
        for symbol, data in orders.items():
            if not symbol in tickers:
                continue

            if tickers[symbol] >= data['sellPrice']:
                available += (data['sellPrice'] * data['volume']) * 0.998
                nbSell = nbSell + 1
                nbSellDaily = nbSellDaily + 1
                #print('SELL 2 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' sellPrice ' + str(data['sellPrice']) + ' volume ' + str(data['volume']) + ' amount ' + str((data['sellPrice'] * data['volume'])) + ' amount ' + str((data['sellPrice'] * data['volume']) * 0.992))

                del orders_try[symbol]
            elif tickers[symbol] <= data['limitPrice']:
                available += (data['limitPrice'] * data['volume']) * 0.998
                nbLoss = nbLoss + 1
                nbLossDaily = nbLossDaily + 1
                #print('LIMIT 2 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' sellPrice ' + str(data['limitPrice']) + ' volume ' + str(data['volume']) + ' amount ' + str((data['limitPrice'] * data['volume'])) + ' amount ' + str((data['limitPrice'] * data['volume']) * 0.992))

                del orders_try[symbol]

        orders = orders_try

        mise = capital * config_mise / 100

        symbol_buyable = []
        for data in datas:
            symbol, price, lavg, avg, maxPrice = data['symbol'], float(data['price']), data['lavg'], float(data['avg']), float(data['max'])

            if symbol in orders.keys():
                continue

            if lavg < 600:
                continue

            am_price = ((price - (avg * (100 - config_median[0]) / 100))
                / (avg * (100 - config_median[0]) / 100)) * 100

            if not (price > 0 \
                and avg * (100 - config_median[0]) / 100 >= price \
                and avg * (100 - config_median[1]) / 100 <= price \
                and (((maxPrice - avg) / avg) * 100) >= config_prc):
                continue

            symbol_buyable.append([symbol, price, am_price])

        symbol_buyable = sorted(symbol_buyable, key=lambda x: x[2])
        nbSymbol = int(int(available) / mise)

        for data in symbol_buyable[0:nbSymbol]:
            symbol, price = data[0], data[1]

            orders[symbol] = { 'price': price, 'sellPrice': price * (config_profit / 100 + 1), 'limitPrice': price * (1 - config_stoploss / 100),
                'volume': mise / price, 'date': date_now }

            #print('BUY 1 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' price ' + str(price) + ' volume ' + str(orders[symbol]['volume']) + ' sellPrice ' + str(price * (config_profit / 100 + 1)) + ' limitPrice ' + str(price * (1 - config_stoploss / 100)))
            available -= round(price * orders[symbol]['volume'], 2)
            #print('BUY 2 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' price ' + str(price) + ' volume ' + str(orders[symbol]['volume']) + ' sellPrice ' + str(price * (config_profit / 100 + 1)) + ' limitPrice ' + str(price * (1 - config_stoploss / 100)))

        if max_capital == None or capital > max_capital:
            max_capital = capital

        if available < -5 or capital < -5:
            print("ERROR")
            print(str(date_now) + ' ' + str([config_mise, config_median, config_prc, config_profit, config_stoploss, str(startDate)]) + ' capital: ' + str(capital) + '/' + str(investissement) + ' max_capital: ' + str(max_capital) + ' available: ' + str(available) + ' nbOrder: ' + str(len(orders)) + ' nbSell: ' + str(nbSell) + ' nbLoss: ' + str(nbLoss) + ' Dead: ' + str(len(symbol_dead)))
            exit(1)

        if date_now.hour == 23 and date_now.minute == 45:
            print(str(date_now) + ' ' + str([config_mise, config_median, config_prc, config_profit, config_stoploss, str(startDate)]) + ' prc: ' + str(int((capital - investissement) / investissement * 100)) + ' (' + str(int((capital - prev_capital) / prev_capital * 100)) + ') capital: ' + str(capital) + '/' + str(int(investissement)) + ' max_capital: ' + str(max_capital) + ' available: ' + str(available) + ' nbOrder: ' + str(len(orders)) + ' nbSell: ' + str(nbSellDaily) + ' nbLoss: ' + str(nbLossDaily) + ' Dead: ' + str(len(symbol_dead)))

            rapport.append({ 'x': f"{date_now.year}, {date_now.month}, {date_now.day}", 'y': capital})

            nbSellDaily = 0
            nbLossDaily = 0
            # print("----------------------")
            prev_capital = capital

    print(str(date_now) + ' ' + str([config_mise, config_median, config_prc, config_profit, config_stoploss, str(startDate)]) + ' prc: ' + str(int((capital - investissement) / investissement * 100)) + ' capital: ' + str(int(capital)) + '/' + str(int(investissement)) + ' max_capital: ' + str(int(max_capital)) + ' available: ' + str(int(available)) + ' nbOrder: ' + str(len(orders)) + ' nbSell: ' + str(nbSell) + ' nbLoss: ' + str(nbLoss) + ' Dead: ' + str(len(symbol_dead)))

    # print(
    # "            {\n" +
    # "                type:\"line\",\n" +
    # "                axisYType: \"secondary\",\n" +
    # "                name: \"Profit " + str(config_profit)  + "% | Mise " +  str(config_mise) + "% | Stop " +  str(config_stoploss) + " | Median " +  str(config_median[0]) + "% | Prc " + str(config_prc) + "%\",\n" +
    # "                showInLegend: false,\n" +
    # "                markerSize: 0,\n" +
    # "                yValueFormatString: \"$#,###\",\n" +
    # "                dataPoints: [")

    # for x in rapport:
    #     print("                    { x: new Date(" + x['x'] + "), y: " + str(x['y']) + " },")

    # print(
    #     "                ]\n" +
    #     "            },")

print("Simulation start")

simulator(1255, 4, [-10, 40], 10, 7, 1, 0, datetime.strptime('01-11-2020', "%d-%m-%Y"), datetime.strptime('01-12-2020', "%d-%m-%Y"))

print("Simulation end")
