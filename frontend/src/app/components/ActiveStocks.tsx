import { Card } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Link } from "react-router";

export function ActiveStocks() {
  const stocks = [
    { ticker: "SCOM", price: "28.50", change: "+5.2%", volume: "15.2M", isPositive: true },
    { ticker: "EQTY", price: "52.75", change: "+3.8%", volume: "8.4M", isPositive: true },
    { ticker: "KCB", price: "45.20", change: "+2.1%", volume: "6.7M", isPositive: true },
    { ticker: "EABL", price: "165.00", change: "+1.5%", volume: "3.2M", isPositive: true },
    { ticker: "BAMB", price: "38.90", change: "-2.4%", volume: "2.8M", isPositive: false },
    { ticker: "COOP", price: "12.85", change: "+0.9%", volume: "4.1M", isPositive: true },
  ];

  return (
    <Card className="bg-white border-gray-200 p-6">
      <h3 className="text-gray-900 mb-4">Active NSE Stocks</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-gray-50">
              <TableHead className="text-gray-600">Ticker</TableHead>
              <TableHead className="text-gray-600">Price (KES)</TableHead>
              <TableHead className="text-gray-600">Change</TableHead>
              <TableHead className="text-gray-600">Volume</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stocks.map((stock) => (
              <TableRow key={stock.ticker} className="border-gray-200 hover:bg-gray-50 cursor-pointer">
                <TableCell className="text-gray-900 font-semibold">
                  <Link to={`/stock/${stock.ticker}`}>{stock.ticker}</Link>
                </TableCell>
                <TableCell className="text-gray-900">{stock.price}</TableCell>
                <TableCell className={stock.isPositive ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                  {stock.change}
                </TableCell>
                <TableCell className="text-gray-600">{stock.volume}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
