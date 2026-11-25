const res = await fetch('https://stocksintels.com/developers/api-keys', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
});
console.log('Status:', res.status);
console.log('Headers:');
for (const [key, value] of res.headers.entries()) {
    console.log(`  ${key}: ${value}`);
}