const res = await fetch('https://stocksintels.com/developers/api-keys');
const text = await res.text();
console.log(text);