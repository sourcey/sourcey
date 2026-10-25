import type { CurrentPage } from "../core/site-model.js";
import type { NormalizedSpec } from "../core/types.js";
import type { SiteNavigation } from "../core/navigation.js";
import {
  SpecContext,
  OptionsContext,
  NavigationContext,
  PageContext,
  SiteContext,
} from "../renderer/context.js";
import type { RenderOptions, SiteConfig } from "../renderer/context.js";
import { Head } from "./layout/Head.js";
import { Page } from "./layout/Page.js";
import { PagePart } from "./layout/PagePart.js";

export interface AppProps {
  spec: NormalizedSpec | undefined;
  options: RenderOptions;
  navigation: SiteNavigation;
  currentPage: CurrentPage;
  site: SiteConfig;
}

/**
 * Root component. Renders a complete HTML document with modern layout.
 * When embeddable, renders just the page content without html/body wrapper.
 */
export function App({ spec, options, navigation, currentPage, site }: AppProps) {
  const content = options.embeddable ? (
    <Page />
  ) : (
    // A not-found page says so on its root, where a script in the head can read it.
    <html lang={options.lang} dir={options.dir} data-sourcey-page={options.notFound ? "not-found" : undefined}>
      <Head />
      <body id="sourcey" data-sourcey-theme={site.theme.name}>
        <PagePart name="Banner" />
        <Page />
        {options.assets && <script src={options.assets.client} type={options.assets.clientType} defer />}
        <PagePart name="BodyEnd" />
      </body>
    </html>
  );

  return (
    <SiteContext.Provider value={site}>
      <SpecContext.Provider value={spec!}>
        <OptionsContext.Provider value={options}>
          <NavigationContext.Provider value={navigation}>
            <PageContext.Provider value={currentPage}>{content}</PageContext.Provider>
          </NavigationContext.Provider>
        </OptionsContext.Provider>
      </SpecContext.Provider>
    </SiteContext.Provider>
  );
}
