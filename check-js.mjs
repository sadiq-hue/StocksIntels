const res = await fetch('https://stocksintels.com/assets/index-CPolw5Ug.js');
console.log('Status:', res.status);
const text = await res.text();
console.log('Length:', text.length);
console.log(text.substring(0, 500));