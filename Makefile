all: clean
	babel -d dist/ lib/

clean:
	rm -rf dist/*
