# Migration map

Combine the one-time vendor compatibility code with its deployment region.

| Compatibility code | Region | compatibilityMode | preserveLegacyIds | reportTag |
|---|---|---|---:|---|
| R5 | eu | compat | true | EU-R5 |
| R7 | apac | bridge | true | APAC-R7 |
| R7 | us | strict | false | US-R7 |
| R9 | apac | strict | false | APAC-R9 |

The source vendor response is one-time sensitive material. Remove it after deriving the
migration decision. Do not copy its raw content into another file.
