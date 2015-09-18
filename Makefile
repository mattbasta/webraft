all:
	browserify index.js -t babelify --outfile dist/dist.js
