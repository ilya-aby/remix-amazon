// ==UserScript==
// @name         Amazon Remix
// @namespace    http://tampermonkey.net/
// @version      2024-09-26
// @description  Fix the Amazon search experience
// @author       ilya@
// @match        https://www.amazon.com/s*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=amazon.com
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

// Hide the existing elements on the Amazon search pages
function hideExistingPage() {
  const rhfElement = document.getElementById('rhf');
  const searchElement = document.getElementById('search');
  if (rhfElement) {
    rhfElement.style.display = 'none';
  }
  if (searchElement) {
    searchElement.style.display = 'none';
  }
}

// Scrapes product data from Amazon search results and stores it in an array
// We later use this data to create new product cards
function extractProductData() {
  const products = [];
  const seenASINs = new Set();
  const productCards = document.querySelectorAll('[data-component-type="s-search-result"]');
  
  productCards.forEach(card => {
    const asin = card.dataset.asin;

    // Extra failsafe to prevent duplicate products
    if (seenASINs.has(asin)) {
      return;
    }
    seenASINs.add(asin);

    const name = extractProductName(card);
    const { baseName, attributes } = extractBaseNameAndAttributes(name);
    const product = {
      id: asin,
      name,
      baseName,
      attributes,
      reviewScore: extractReviewScore(card),
      numRatings: extractNumRatings(card),
      numPurchased: extractNumPurchased(card),
      price: extractPrice(card),
      roundedPrice: roundPrice(extractPrice(card)),
      deliveryDate: extractDeliveryDate(card),
      productImageUrl: extractProductImageUrl(card),
      productUrl: extractProductUrl(card) // New attribute
    };
    products.push(product);
  });

  // Sort products by number of ratings (descending order)
  products.sort((a, b) => (b.numRatings || 0) - (a.numRatings || 0));

  console.table(products);
  return products;
}

function extractProductUrl(card) {
  const linkElement = card.querySelector('[data-cy="title-recipe"] a.a-link-normal');
  if (linkElement) {
    const relativeUrl = linkElement.href;
    const absoluteUrl = new URL(relativeUrl, window.location.origin).href;
    return absoluteUrl;
  }
  return null;
}

function extractProductImageUrl(card) {
  const imageElement = card.querySelector('.s-image');
  return imageElement ? imageElement.src : 'N/A';
}

function extractProductName(card) {
  const nameElement = card.querySelector('h2 a span');
  return nameElement ? nameElement.textContent.trim() : 'N/A';
}

function extractReviewScore(card) {
  const ratingElement = card.querySelector('[aria-label*="out of 5 stars"]');
  if (ratingElement) {
    const match = ratingElement.getAttribute('aria-label').match(/(\d+(\.\d+)?) out of 5 stars/);
    return match ? parseFloat(match[1]) : null;
  }
  return null;
}

function extractNumRatings(card) {
  const ratingsElement = card.querySelector('[data-cy="reviews-block"] [aria-label*="ratings"]');
  if (ratingsElement) {
    const ariaLabel = ratingsElement.getAttribute('aria-label');
    const match = ariaLabel.match(/(\d+(?:,\d+)*)/);
    return match ? parseInt(match[1].replace(/,/g, '')) : null;
  }
  return null;
}

function extractNumPurchased(card) {
  const purchasedElement = card.querySelector('[data-cy="reviews-block"] .a-size-base.a-color-secondary');

  if (purchasedElement && 
    (purchasedElement.textContent.includes('bought') || purchasedElement.textContent.includes('reordered'))) {
    const match = purchasedElement.textContent.match(/(\d+(?:\.\d+)?K?)\+?/);
    if (match) {
      const numText = match[1];
      if (numText.toUpperCase().endsWith('K')) { // Handle both 'k' and 'K'
        return Math.round(parseFloat(numText.slice(0, -1)) * 1000);
      } else {
        return parseInt(numText.replace(/,/g, ''), 10);
      }
    }
  }
  return null;
}

function extractPrice(card) {
  const priceElement = card.querySelector('.a-price .a-offscreen');
  return priceElement ? priceElement.textContent.trim() : 'N/A';
}

function roundPrice(price) {
  if (price === 'N/A') return 'N/A';
  let number = parseFloat(price.replace(/[^0-9.]/g, ''));
  return isNaN(number) ? 'N/A' : Math.round(number);
}

function extractDeliveryDate(card) {
  const deliveryElement = card.querySelector('[data-cy="delivery-recipe"] .a-text-bold');
  return deliveryElement ? deliveryElement.textContent.trim() : 'N/A';
}

// Typical Amazon product name format: "JBL Clip 3, Black - Waterproof, Durable & Portable Bluetooth Speaker - Up to 10 Hours of Play"
// We want to process the name to separate out the base name and the attributes
// In this case, the base name is "JBL Clip 3" and the attributes are ["Black", "Waterproof", "Durable", etc]
function extractBaseNameAndAttributes(name) {
  const splitTokens = ['with', 'for', ' - ', '–', ',', '\\|'];
  let parts = [name];
  const attributes = [];

  // Extract content within parentheses and square brackets first
  const bracketsRegex = /[\(\[]([^\)\]]+)[\)\]]/g;
  let bracketsMatch;
  while ((bracketsMatch = bracketsRegex.exec(name)) !== null) {
    // Split the bracketed content by comma and 'and'
    const splitAttributes = bracketsMatch[1]
      .split(/,|\band\b/)
      .map(attr => attr.trim())
      .filter(attr => attr.length > 0);
    attributes.push(...splitAttributes);
  }
  // Remove the bracketed content from the original name
  parts[0] = parts[0].replace(bracketsRegex, '').trim();

  // Split the remaining name by the defined split tokens
  for (const token of splitTokens) {
    parts = parts.flatMap(part => {
      const regex = new RegExp(`\\s*${token}\\s*`, 'i');
      return part.split(regex);
    });
  }

  // The first part becomes the baseName, the rest are attributes
  const baseName = parts.shift().trim();
  // Split the non-bracketed attributes further by comma and 'and'
  const additionalAttributes = parts
    .flatMap(attr => attr.split(/,|\band\b/)
      .map(a => a.trim())
      .filter(a => a.length > 0)
    );
  attributes.push(...additionalAttributes);

  // Clean up attributes and handle ", and" case
  const cleanAttributes = attributes.map(attr => {
    attr = attr.replace(/^[,\s]+|[,\s]+$/g, '');
    return attr.startsWith('and ') ? attr.slice(4) : attr;
  }).filter(attr => attr !== '');

  console.log(name, baseName, cleanAttributes);
  return { baseName, attributes: cleanAttributes };
}

function getRatingColor(rating) {
  if (rating >= 4.5) return 'dark-green';
  if (rating >= 4.2) return 'light-green';
  if (rating >= 3.9) return 'yellow';
  return 'red';
}

// CSS for all the product cards we add when we reconstruct the page
// Tampermonkey gives us the ability to add styles to the page via GM_addStyle
function injectCss() {
  const css = 
  `
  .product-card-container {
    display: flex;
    flex-wrap: wrap;
    margin: 16px 16px;
    gap: 16px;
    justify-content: center;
  }

  .product-card {
    display: flex;
    flex-direction: column;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 16px;
    width: 350px;
    // height: 525px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }

  .product-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
  }

  .product-card-image-container {
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    background-color: white;
  }

  .product-card img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .product-info {
    margin-bottom: 16px;
  }

  .product-info h2 {
    font-size: 1rem;  
    margin-bottom: 8px;
    line-height: 1.2;
  }

  .product-info ul {
    list-style-type: none;
    padding: 0;
    margin: 0 0 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .product-info ul li {
    display: contents;
  }

  .product-info ul li::marker {
    display: none;
  }

  .attribute-pill {
    display: inline-block;
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 10px;
    background-color: #f0f0f0;
    color: #333;
  }

  .review-score-container {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }

  .num-ratings {
    font-size: 0.8rem;
    color: gray;
  }

  .num-purchased {
    margin-left: auto;
    font-size: 0.8rem;
    color: gray;
  }

  .fa-pill {
      display: inline-block;
      font-size: 0.9rem;
      font-weight: bold;
      margin-left: 2px;
      margin-right: 2px;
      padding: 4px 8px;
      border-radius: 12px;
  }
  .fa-pill.red {
      background-color: #ffcdd2;
      color: #b71c1c;
  }
  .fa-pill.yellow {
      background-color: #fff9c4;
      color: #f57f17;
  }
  .fa-pill.light-green {
      background-color: #e8f5e9;
      color: #2e7d32;
  }
  .fa-pill.dark-green {
      background-color: #a5d6a7;
      color: #1b5e20;
  }

  .product-name-container {
    height: 2.8em;
    margin-bottom: 8px;
    overflow: hidden;
  }

  .product-name {
    font-size: 1rem;
    line-height: 1.2;
    margin: 0;
    text-decoration: none;
    color: black;
  }

  a.product-name:visited, a.product-name:link {
    color: black;
  }

  a.product-name:hover {
    color: #b65c22;
    text-decoration: none;
  }

  .product-name:hover {
    color: #b65c22;
    text-decoration: none;
  }

  .price-delivery-container {
    display: flex;
    align-items: center;
    margin-top: 35px;
  }

  .price {
    font-size: 1.8rem;
    font-weight: bold;
  }

  .delivery-estimate {
    margin-left: auto;
    font-size: 1rem;
  }

  .attributes-list {
    list-style-type: none;
    padding: 0;
    margin: 8px 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
  }

  .attributes-list li {
    display: contents;
  }

  .attributes-list li::marker {
    display: none;
  }
  `;
  
  GM_addStyle(css);
}

function createRatingPill(rating, numRatings) {
  if (!rating) return false;
  return `<span class="fa-pill ${getRatingColor(rating)}">⭐️ ${rating.toFixed(1)}</span> ${numRatings ? `<span class='num-ratings'>${condenseNumber(numRatings)}</span>` : ''}`;
}

// Helper function to condense large numbers into a more readable format
// 1000 -> 1k, 10000 -> 10k, 100000 -> 100k, etc
function condenseNumber(number) {
  if (!number) return '';
  if (number >= 1000) {
    const condensed = (number / 1000).toFixed(1);
    return condensed.endsWith('.0') ? condensed.slice(0, -2) + 'k' : condensed + 'k';
  }
  return number.toString();
}

// Creates new product cards and adds them to the page
function createProductCards(productData) {
  const productCards = document.createElement('div');
  productCards.className = 'product-card-container';

  productData.forEach(product => {
    // Sort attributes by length
    const sortedAttributes = product.attributes.sort((a, b) => a.length - b.length);

    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-card-image-container">
        <img src="${product.productImageUrl}" alt="${product.baseName}">
      </div>
      <div class="product-info">
        <div class="product-name-container">
          <a class="product-name" href="${product.productUrl}" target="_blank">${product.baseName}</a>
        </div>
        <div class="review-score-container">
          ${createRatingPill(product.reviewScore, product.numRatings)}
          <span class='num-purchased'>${product.numPurchased ? condenseNumber(product.numPurchased) + ' recent purchases': ''}</span>
        </div>
        <div class="price-delivery-container">
          <div class="price">$${product.roundedPrice}</div>
          <div class="delivery-estimate">📦 ${product.deliveryDate}</div>
        </div>
      </div>
      <ul class="attributes-list">${sortedAttributes.map(attr => `<li><span class="attribute-pill">${attr}</span></li>`).join('')}</ul>
    `;
    productCards.appendChild(card);
  });

  return productCards;
}

function main() {
  hideExistingPage();
  injectCss();
  const productData = extractProductData();
  const productCards = createProductCards(productData);
  const searchElement = document.querySelector('#search');
  if (searchElement) {
    searchElement.parentNode.insertBefore(productCards, searchElement.nextSibling);
  }
}

main();