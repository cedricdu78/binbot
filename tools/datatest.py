import os
import json
from datetime import datetime
from operator import itemgetter

print("Loading dataset ... ")
datasource = json.load(open('../lib/assets/data.json', 'r'))
datasource = {k: datasource[k] for k in sorted(datasource)}
print("Loading dataset OK")

def simulator(available, config_mise, config_median, config_prc, config_profit, config_stoploss, depot, year):
    orders = {}
    nbSell = 0
    nbLoss = 0
    investissement = available

    rapport = []

    symbol_dead = set()

    max_capital = None

    for timestamp, datas in datasource.items():

        date_now = datetime.fromtimestamp(int(timestamp) / 1000)

        if date_now.year < year:
            continue

        if date_now.day == 1 and date_now.hour == 8 and date_now.minute == 15:
            available += depot
            investissement += depot
            # print(f"depot {depot} USDT")

        capital = available
        tickers = {}
        for data in datas:
            tickers[data['symbol']] = float(data['price'])

        orders_try = orders.copy()
        for symbol, data in orders.items():
            if not symbol in tickers:
                symbol_dead.add(symbol)
                continue
            elif symbol in symbol_dead:
                symbol_dead.remove(symbol)

            if tickers[symbol] >= data['sellPrice']:
                capital += (data['sellPrice'] * data['volume']) * 0.998
            elif tickers[symbol] <= data['limitPrice']:
                capital += (data['limitPrice'] * data['volume']) * 0.998
            else:
                capital += tickers[symbol] * data['volume']

        for symbol, data in orders.items():
            if not symbol in tickers:
                continue

            if tickers[symbol] >= data['sellPrice']:
                available += (data['sellPrice'] * data['volume']) * 0.998

                nbSell = nbSell + 1
                del orders_try[symbol]
            elif tickers[symbol] <= data['limitPrice']:
                available += (data['limitPrice'] * data['volume']) * 0.998

                nbLoss = nbLoss + 1
                del orders_try[symbol]

        orders = orders_try

        mise = capital * config_mise / 100

        symbol_buyable = []
        for data in datas:
            symbol, price, lavg, avg, maxPrice = data['symbol'], float(data['price']), data['lavg'], float(data['avg']), float(data['max'])

            if symbol in orders.keys():
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

        for data in symbol_buyable[:nbSymbol]:
            symbol, price = data[0], data[1]

            # print('BUY 1 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' sellPrice ' + str(price * (config_profit / 100 + 1)) + ' limitPrice ' + str(price * (1 - config_stoploss / 100)))

            orders[symbol] = { 'price': price, 'sellPrice': price * (config_profit / 100 + 1), 'limitPrice': price * (1 - config_stoploss / 100),
                'volume': mise / price, 'date': date_now }
            available -= price * orders[symbol]['volume']

            # print('BUY 2 ' + symbol + ' capital ' + str(capital) + ' available ' + str(available) + ' sellPrice ' + str(price * (config_profit / 100 + 1)) + ' limitPrice ' + str(price * (1 - config_stoploss / 100)))

        if max_capital == None or capital > max_capital:
            max_capital = capital

        if available < 10:
            print(str(date_now) + ' ' + str([config_mise, config_median, config_prc, config_profit, config_stoploss]) + ' capital: ' + str(capital) + '/' + str(investissement) + ' max_capital: ' + str(int(max_capital)) + ' available: ' + str(available) + ' nbOrder: ' + str(len(orders)) + ' nbSell: ' + str(nbSell) + ' nbLoss: ' + str(nbLoss) + ' Dead: ' + str(len(symbol_dead)))
            exit(1)

        # if date_now.day == 28 and date_now.hour == 23 and date_now.minute == 0:
        # print('')
    print(str(date_now) + ' ' + str([config_mise, config_median, config_prc, config_profit, config_stoploss]) + ' capital: ' + str(int(capital)) + '/' + str(int(investissement)) + ' max_capital: ' + str(int(max_capital)) + ' available: ' + str(int(available)) + ' nbOrder: ' + str(len(orders)) + ' nbSell: ' + str(nbSell) + ' nbLoss: ' + str(nbLoss) + ' Dead: ' + str(len(symbol_dead)))

print("Simulation start")

simulator(2000, 4, [-10, 40], 10, 15, 1, 0, 2020)
simulator(2000, 4, [-10, 40], 10, 15, 1, 0, 2021)
simulator(2000, 4, [-10, 40], 10, 15, 1, 0, 2022)
simulator(2000, 4, [-10, 40], 10, 15, 1, 0, 2023)
simulator(2000, 4, [-10, 40], 10, 15, 1, 0, 2024)

# simulator(2000, 4, [-10, 40], 10, 15, 1, 1000, 2020)
# simulator(2000, 4, [-10, 40], 10, 15, 1, 1000, 2021)
# simulator(2000, 4, [-10, 40], 10, 15, 1, 1000, 2022)
# simulator(2000, 4, [-10, 40], 10, 15, 1, 1000, 2023)
# simulator(2000, 4, [-10, 40], 10, 15, 1, 0, 2024)

print("Simulation end")
