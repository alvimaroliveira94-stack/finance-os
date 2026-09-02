/**
 * Adaptador de arquivos (DriveApp). Único ponto que lê arquivos de extrato.
 * Contrato: lerArquivo(idOuNome) -> {nome:string, conteudo:string}
 */
(function (root) {
  'use strict';
  var FOS = root.FOS = root.FOS || {};
  FOS.Adapters = FOS.Adapters || {};

  function criar(driveApp) {
    return {
      lerArquivoPorId: function (fileId) {
        var arquivo = driveApp.getFileById(fileId);
        return { nome: arquivo.getName(), conteudo: arquivo.getBlob().getDataAsString() };
      },
      lerArquivoPorNome: function (nome) {
        var iterador = driveApp.getFilesByName(nome);
        if (!iterador.hasNext()) {
          FOS.Core.fail('ARQUIVO_NAO_ENCONTRADO', 'Arquivo não encontrado no Drive: ' + nome);
        }
        var arquivo = iterador.next();
        if (iterador.hasNext()) {
          FOS.Core.fail('ARQUIVO_AMBIGUO', 'Mais de um arquivo com o nome: ' + nome);
        }
        return { nome: arquivo.getName(), conteudo: arquivo.getBlob().getDataAsString() };
      }
    };
  }

  FOS.Adapters.criarDrive = criar;

  FOS.Adapters.driveAtivo = function () {
    if (typeof DriveApp === 'undefined') {
      FOS.Core.fail('DRIVE_APP_INDISPONIVEL', 'DriveApp só existe no Apps Script');
    }
    return criar(DriveApp);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
