# rppl.app marketing site

Built with Jekyll.

## Getting Started

The rppl marketing site is built with Jekyll and uses standard Jekyll includes for components. Components are organized in the `_includes/components/` directory for easy developer access and modification.

## Getting started

The site uses standard Jekyll conventions for maximum developer flexibility.

### Prerequisites

The marketing site relies primarily on Jekyll for development.

- Ruby (check if already installed, if not [install here](https://www.ruby-lang.org/en/documentation/installation/))

  ```sh
  ruby -v
  ```

- Bundler

  ```sh
  gem install bundler
  ```

- Jekyll

  ```sh
  gem install jekyll
  ```

### Installation

1. In the `site` directory, install Jekyll dependencies by running:

```sh
bundle install
```

2. In the root directory, install dependencies by running:

```sh
npm install
```

3. In the root directory, launch a local development server by running:

```sh
npm start
```

### Build and Deploy

1. Running this command ensures that the sitemap is using the correct host:

```sh
npm run build
```

2. Deploy

```sh
firebase deploy
```
